import type { TableState } from '@pos/domain';
import type { AlertCard, AlertLock } from '@pos/events';
import type { MapPerson, MapTile, TableMapBody } from '../contracts';

// 02a v1.1.6 §8 Table map (21b): the map's pure rules. What the screen shows comes from here so the components stay
// thin: sections (zones in setup order, then No zone, then Archived tables), Mine, the zone heading's assignee (Q-25),
// minutes open, late flags (Q-17), and the Needs-you list.

export type MapFilter = 'all' | 'mine';

export interface Section {
  key: string;
  kind: 'zone' | 'none' | 'archived';
  /** the zone's name; null for No zone and Archived tables (the client supplies those labels) */
  name: string | null;
  tiles: MapTile[];
}

/** Mine = tables I hold or am assigned (CHANGES Q2). */
export function isMine(tile: MapTile, staffId: string | null): boolean {
  if (staffId === null) return false;
  return tile.holder?.staff_id === staffId || tile.assignee?.staff_id === staffId;
}

/**
 * The sections of the map for a floor (null = every configured floor): each floor's zones in setup order, the No-zone
 * tables of a floor after its named zones, and the archived pseudo-floor (`archived: true`, §6.17) as one group at the
 * end, even under a floor filter. Under Mine a section with none of my tables is left out.
 */
export function sectionsOf(map: TableMapBody | null, o: { floor_id: string | null; filter: MapFilter; staffId: string | null }): Section[] {
  if (map === null) return [];
  const keep = (tiles: MapTile[]) => (o.filter === 'mine' ? tiles.filter((t) => isMine(t, o.staffId)) : tiles);
  const out: Section[] = [];
  const archived: MapTile[] = [];
  for (const floor of map.floors) {
    if (floor.archived) {
      for (const zone of floor.zones) archived.push(...zone.tables);
      continue;
    }
    if (o.floor_id !== null && floor.floor_id !== o.floor_id) continue;
    const named = floor.zones.filter((z) => z.zone_id !== null);
    const none = floor.zones.filter((z) => z.zone_id === null);
    for (const zone of named) {
      const tiles = keep(zone.tables);
      if (tiles.length > 0) out.push({ key: `${floor.floor_id}:${zone.zone_id ?? ''}`, kind: 'zone', name: zone.name, tiles });
    }
    const loose = keep(none.flatMap((z) => z.tables));
    if (loose.length > 0) out.push({ key: `${floor.floor_id}:none`, kind: 'none', name: null, tiles: loose });
  }
  const tail = keep(archived);
  if (tail.length > 0) out.push({ key: 'archived', kind: 'archived', name: null, tiles: tail });
  return out;
}

/** Q-25: the heading names an assignee only when every tile of the zone has the same one. */
export function zoneAssignee(tiles: readonly MapTile[]): MapPerson | null {
  const first = tiles[0]?.assignee ?? null;
  if (first === null) return null;
  return tiles.every((t) => t.assignee?.staff_id === first.staff_id) ? first : null;
}

export function stateCounts(tiles: readonly MapTile[]): Record<TableState, number> {
  const counts: Record<TableState, number> = { FREE: 0, SEATED: 0, ORDERED: 0, FOOD_ON_TABLE: 0, BILL_REQUESTED: 0, NEEDS_CLEANING: 0 };
  for (const t of tiles) counts[t.state] += 1;
  return counts;
}

/** Whole minutes since the seating opened, on the hub clock; null when the tile has no seating. */
export function minutesOpen(tile: MapTile, nowMs: number): number | null {
  return tile.opened_at === null ? null : Math.max(0, Math.floor((nowMs - tile.opened_at) / 60_000));
}

export function minutesSince(ms: number, nowMs: number): number {
  return Math.max(0, Math.floor((nowMs - ms) / 60_000));
}

// ------------------------------------------------------------------------------------------- alert-derived flags

/** The part of an alert-store row the map reads (the store's `AlertRow` fits). */
export interface MapAlertRow {
  alert_id: string;
  kind: string;
  state: 'open' | 'closed';
  raised_at: number;
  lock: AlertLock;
  card?: AlertCard | undefined;
}

/** The part of the `orders` catch-up the late flag follows once the hub sends `open_slips` (H5). */
export interface SlipOrders {
  orders: Array<{ order_id: string; table_key: string }>;
  open_slips?: Array<{ alert_id: string; order_ids: string[] }> | undefined;
}

const names = (t: MapTile): string[] => (t.joined_table_names.length > 0 ? t.joined_table_names : [t.name]);

/**
 * Q-17: the tiles that are late — from my own open `slip_warning` rows. Until H5 a row is matched to a tile by
 * `table_code` (fixed at raise: after a move the flag stays on the old table). With `open_slips`, the row follows the
 * slip's `order_ids` (`table_key` is `dine_in:<seating_id>`) to the seating's current tile. Value = minutes late, or
 * null when the row carries no card. No void-waiting and no bill-paid flag (04, 05 not built).
 */
export function lateTables(rows: readonly MapAlertRow[], tiles: readonly MapTile[], orders: SlipOrders | null): Map<string, number | null> {
  const late = new Map<string, number | null>();
  for (const row of rows) {
    if (row.kind !== 'slip_warning' || row.state !== 'open') continue;
    const target = followSlip(row.alert_id, tiles, orders) ?? byTableCode(row.lock.table_code, tiles);
    if (target === null) continue;
    const minutes = row.card?.details?.minutes_late ?? null;
    const was = late.get(target.table_id);
    if (was === undefined || (minutes !== null && (was === null || minutes > was))) late.set(target.table_id, minutes);
  }
  return late;
}

function byTableCode(code: string | null | undefined, tiles: readonly MapTile[]): MapTile | null {
  if (code === null || code === undefined) return null;
  return tiles.find((t) => names(t).includes(code)) ?? null;
}

function followSlip(alertId: string, tiles: readonly MapTile[], orders: SlipOrders | null): MapTile | null {
  const slip = orders?.open_slips?.find((s) => s.alert_id === alertId);
  if (orders === null || slip === undefined) return null;
  for (const orderId of slip.order_ids) {
    const key = orders.orders.find((o) => o.order_id === orderId)?.table_key;
    if (key === undefined || !key.startsWith('dine_in:')) continue;
    const seating = key.slice('dine_in:'.length);
    const tile = tiles.find((t) => t.seating_id === seating);
    if (tile !== undefined) return tile;
  }
  return null;
}

/** An open `call_waiter` row as a Needs-you source: the table it names, who called, when. */
export interface CallItem {
  alert_id: string;
  table_id: string;
  requester: string | null;
  raised_at: number;
}

export function callsOf(rows: readonly MapAlertRow[], tiles: readonly MapTile[]): CallItem[] {
  const out: CallItem[] = [];
  for (const row of rows) {
    if (row.kind !== 'call_waiter' || row.state !== 'open') continue;
    const tile = byTableCode(row.lock.table_code, tiles);
    if (tile === null) continue;
    out.push({ alert_id: row.alert_id, table_id: tile.table_id, requester: row.lock.requester_name ?? null, raised_at: row.raised_at });
  }
  return out.sort((a, b) => b.raised_at - a.raised_at);
}

// ------------------------------------------------------------------------------------------------- Needs you

export type NeedsKind = 'bill' | 'late' | 'call' | 'clean' | 'ordering';

export interface NeedsItem {
  key: string;
  kind: NeedsKind;
  table_id: string;
  seating_id: string | null;
  /** the tile's display name ("F4 + F5") */
  name: string;
  /** minutes since the bill was asked / the call was raised / minutes late (null = unknown) */
  minutes: number | null;
  /** bill: it is my table */
  mine?: boolean;
  /** who: the holder (bill, for tables that are not mine), the caller (call), the person ordering (ordering) */
  who?: string | null;
}

const ORDER: NeedsKind[] = ['bill', 'late', 'call', 'clean', 'ordering'];

export const tileName = (t: MapTile): string => names(t).join(' + ');

/**
 * 02a-S03 Needs you (CHANGES Q16, Q-17). A taker: my tables with Bill asked, To clean and late food, plus someone
 * ordering on a table of my zone. A waiter (no take-order): open calls and tables to clean. The cashier kiosk: every
 * Bill asked and every table to clean. "Bill paid {time}" waits for module 05, "Void waiting" for 04.
 */
export function needsYou(o: {
  tiles: readonly MapTile[];
  staffId: string | null;
  role: 'taker' | 'waiter' | 'cashier';
  nowMs: number;
  late: ReadonlyMap<string, number | null>;
  calls: ReadonlyArray<{ alert_id: string; table_id: string; requester: string | null; raised_at: number }>;
}): NeedsItem[] {
  const items: NeedsItem[] = [];
  const add = (t: MapTile, kind: NeedsKind, extra: Partial<NeedsItem> = {}) =>
    items.push({ key: `${kind}:${t.table_id}`, kind, table_id: t.table_id, seating_id: t.seating_id, name: tileName(t), minutes: null, ...extra });
  const billAge = (t: MapTile) => (t.bill_requested_at === null ? null : minutesSince(t.bill_requested_at, o.nowMs));
  for (const t of o.tiles) {
    if (t.archived) continue;
    const mine = isMine(t, o.staffId);
    if (o.role === 'taker') {
      if (t.state === 'BILL_REQUESTED' && mine) add(t, 'bill', { minutes: billAge(t), mine: true });
      if (mine && o.late.has(t.table_id)) add(t, 'late', { minutes: o.late.get(t.table_id) ?? null });
      if (t.state === 'NEEDS_CLEANING' && mine) add(t, 'clean');
      if (t.lock !== null && !t.lock.mine && t.assignee?.staff_id === o.staffId && t.holder?.staff_id !== o.staffId) add(t, 'ordering', { who: t.lock.name });
    } else if (o.role === 'cashier') {
      if (t.state === 'BILL_REQUESTED') add(t, 'bill', { minutes: billAge(t), mine: false, who: t.holder?.name ?? null });
      if (t.state === 'NEEDS_CLEANING') add(t, 'clean');
    } else if (t.state === 'NEEDS_CLEANING') {
      add(t, 'clean');
    }
  }
  if (o.role === 'waiter') {
    for (const c of o.calls) {
      const t = o.tiles.find((x) => x.table_id === c.table_id);
      if (t !== undefined) items.push({ key: `call:${c.alert_id}`, kind: 'call', table_id: t.table_id, seating_id: t.seating_id, name: tileName(t), minutes: minutesSince(c.raised_at, o.nowMs), who: c.requester });
    }
  }
  return items.sort((a, b) => ORDER.indexOf(a.kind) - ORDER.indexOf(b.kind));
}

// ---------------------------------------------------------------------------------------------- floor selection

/**
 * The selected floor lives in the hash query `#/tables?floor=<floor_id>` (absent = every floor; integrator ruling).
 * The top bar's floor control and the phone's floor chips write it; the map reads it. `route` is the hash route
 * without `#` (app/router useHashRoute). On the table sheet's route (`/tables/<id>`) the query is gone: null.
 */
export function floorOf(route: string): string | null {
  const [path = '', search = ''] = route.split('?');
  if (path !== '/tables') return null;
  return new URLSearchParams(search).get('floor');
}

export function floorHref(floor_id: string | null): string {
  return floor_id === null ? '/tables' : `/tables?floor=${encodeURIComponent(floor_id)}`;
}
