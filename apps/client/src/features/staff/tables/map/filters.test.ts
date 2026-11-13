import { describe, expect, it } from 'vitest';
import type { MapTile, TableMapBody } from '../contracts';
import { floorHref, floorOf, isMine, lateTables, minutesOpen, needsYou, sectionsOf, stateCounts, zoneAssignee, type MapAlertRow } from './filters';

// 02a v1.1.6 §8 Table map, Q-17, Q-25: the map's pure rules.

const ALI = { staff_id: 'ST-ALI', name: 'Ali' };
const SARA = { staff_id: 'ST-SARA', name: 'Sara' };
const BILAL = { staff_id: 'ST-BILAL', name: 'Bilal' };

function tile(table_id: string, over: Partial<MapTile> = {}): MapTile {
  return {
    table_id,
    name: table_id,
    seats: 4,
    archived: false,
    state: 'FREE',
    seating_id: null,
    party_size: null,
    primary_table_id: null,
    joined_table_names: [],
    holder: null,
    assignee: null,
    lock: null,
    opened_at: null,
    bill_requested_at: null,
    live_order_count: 0,
    ...over,
  };
}

const MAP: TableMapBody = {
  as_of_seq: 1,
  floors: [
    {
      floor_id: 'F1',
      name: 'Family hall',
      archived: false,
      zones: [
        { zone_id: 'Z1', name: 'Hall', tables: [tile('T1'), tile('T2')] },
        { zone_id: null, name: null, tables: [tile('T9')] },
        { zone_id: 'Z2', name: 'Cabins', tables: [tile('T3', { holder: ALI })] },
      ],
    },
    { floor_id: 'F2', name: 'Rooftop', archived: false, zones: [{ zone_id: 'Z3', name: 'Roof', tables: [tile('R1')] }] },
    { floor_id: '', name: null, archived: true, zones: [{ zone_id: null, name: null, tables: [tile('OLD', { archived: true, state: 'ORDERED' })] }] },
  ],
};

describe('[02a §8 Table map] filters', () => {
  it('[02a §8 Table map] zones in setup order, then No zone, then Archived tables', () => {
    const s = sectionsOf(MAP, { floor_id: null, filter: 'all', staffId: 'ST-ALI' });
    expect(s.map((x) => `${x.kind}:${x.name ?? ''}:${x.tiles.map((t) => t.table_id).join(',')}`)).toEqual([
      'zone:Hall:T1,T2',
      'zone:Cabins:T3',
      'none::T9',
      'zone:Roof:R1',
      'archived::OLD',
    ]);
    // a floor filter keeps that floor's zones and still ends with the archived group (it has no floor)
    expect(sectionsOf(MAP, { floor_id: 'F2', filter: 'all', staffId: null }).map((x) => x.kind)).toEqual(['zone', 'archived']);
  });

  it('[02a §8 Table map] Mine = tables I hold or am assigned', () => {
    const mine = tile('A', { holder: ALI });
    const assigned = tile('B', { assignee: ALI, holder: BILAL });
    const other = tile('C', { holder: BILAL, assignee: SARA });
    expect([mine, assigned, other].map((t) => isMine(t, 'ST-ALI'))).toEqual([true, true, false]);
    const map: TableMapBody = { as_of_seq: 1, floors: [{ floor_id: 'F', name: 'F', archived: false, zones: [{ zone_id: 'Z', name: 'Z', tables: [mine, assigned, other, tile('D')] }] }] };
    const s = sectionsOf(map, { floor_id: null, filter: 'mine', staffId: 'ST-ALI' });
    expect(s[0]?.tiles.map((t) => t.table_id)).toEqual(['A', 'B']);
    expect(sectionsOf(map, { floor_id: null, filter: 'mine', staffId: 'ST-ALI' })).toHaveLength(1);
    // a zone with nothing of mine is left out under Mine
    expect(sectionsOf(MAP, { floor_id: null, filter: 'mine', staffId: 'ST-SARA' })).toEqual([]);
  });

  it('[02a Q-25] zone heading names an assignee only when every tile of the zone has the same assignee', () => {
    expect(zoneAssignee([tile('A', { assignee: SARA }), tile('B', { assignee: SARA })])).toEqual(SARA);
    expect(zoneAssignee([tile('A', { assignee: SARA }), tile('B', { assignee: ALI })])).toBeNull();
    expect(zoneAssignee([tile('A', { assignee: SARA }), tile('B')])).toBeNull();
    expect(zoneAssignee([])).toBeNull();
  });

  it('[02a §8 Table map] counts per state and minutes open from the hub clock', () => {
    const c = stateCounts([tile('A'), tile('B', { state: 'BILL_REQUESTED' }), tile('C', { state: 'BILL_REQUESTED' })]);
    expect(c.FREE).toBe(1);
    expect(c.BILL_REQUESTED).toBe(2);
    expect(c.NEEDS_CLEANING).toBe(0);
    expect(minutesOpen(tile('A', { opened_at: 1_000_000 }), 1_000_000 + 32 * 60_000 + 59_000)).toBe(32);
    expect(minutesOpen(tile('A'), 5)).toBeNull();
  });

  it('[02a Q-17] late flag from my own open slip_warning rows matched by table_code; no void-waiting or bill-paid flag', () => {
    const tiles = [tile('TB4', { name: 'F4', joined_table_names: ['F4', 'F5'], seating_id: 'S1', state: 'ORDERED' }), tile('TB7', { name: 'F7' })];
    const slip = (alert_id: string, table_code: string | null, minutes_late?: number, state: 'open' | 'closed' = 'open'): MapAlertRow => ({
      alert_id,
      kind: 'slip_warning',
      state,
      raised_at: 0,
      lock: { kind_label_key: 'alert.slip_warning.lock', table_code, point_code: null, requester_name: null },
      ...(minutes_late === undefined ? {} : { card: { kind_label_key: 'alert.slip_warning.card', table_code, point_code: null, requester_name: null, device_name: null, details: { minutes_late } } }),
    });
    const late = lateTables([slip('A1', 'F4', 6), slip('A2', 'F7', undefined), slip('A3', 'F9', 3), slip('A4', 'F7', 2, 'closed')], tiles, null);
    expect([...late.entries()]).toEqual([
      ['TB4', 6],
      ['TB7', null],
    ]);
    // a joined seating matches by any of its names
    expect(lateTables([slip('A5', 'F5', 4)], tiles, null).get('TB4')).toBe(4);
    // other kinds never flag
    expect(lateTables([{ ...slip('A6', 'F4', 6), kind: 'void_approval' }], tiles, null).size).toBe(0);
  });

  it('[02a Q-17] once catch-up open_slips exists (H5), the late flag follows the slip\'s order_ids to the seating\'s current tile (after a MoveTable the flag moves)', () => {
    // the slip was raised on F4 (table_code is fixed at raise); the party moved to TB9, same seating S1
    const tiles = [tile('TB4', { name: 'F4' }), tile('TB9', { name: 'F9', seating_id: 'S1', state: 'ORDERED' })];
    const row: MapAlertRow = { alert_id: 'A1', kind: 'slip_warning', state: 'open', raised_at: 0, lock: { kind_label_key: 'k', table_code: 'F4', point_code: null, requester_name: null } };
    // until H5: the flag stays on the old tile (known limit, review m6)
    expect([...lateTables([row], tiles, null).keys()]).toEqual(['TB4']);
    const orders = { orders: [{ order_id: 'O1', table_key: 'dine_in:S1' }], open_slips: [{ alert_id: 'A1', order_ids: ['O1'] }] };
    expect([...lateTables([row], tiles, orders).keys()]).toEqual(['TB9']);
  });

  it('[02a §8 Table map] the selected floor is the hash query ?floor=', () => {
    expect(floorOf('/tables')).toBeNull();
    expect(floorOf('/tables?floor=F%201')).toBe('F 1');
    expect(floorOf('/tables/TB4?seating_id=S1')).toBeNull();
    expect(floorHref('F 1')).toBe('/tables?floor=F%201');
    expect(floorHref(null)).toBe('/tables');
  });
});

describe('[02a §8 Table map] Needs you', () => {
  const NOW = 10_000_000;
  const base = (over: Partial<Parameters<typeof needsYou>[0]> = {}) =>
    needsYou({
      tiles: [],
      staffId: 'ST-ALI',
      role: 'taker',
      nowMs: NOW,
      late: new Map(),
      calls: [],
      ...over,
    });

  it('[02a §8 Table map] taker: my tables with Bill asked, late food, plus someone ordering on a table of my zone', () => {
    const tiles = [
      tile('F6', { state: 'BILL_REQUESTED', holder: ALI, bill_requested_at: NOW - 4 * 60_000, seating_id: 'S6' }),
      tile('F4', { state: 'ORDERED', holder: ALI, seating_id: 'S4' }),
      tile('F7', { state: 'SEATED', holder: BILAL, assignee: ALI, lock: { ...BILAL, mine: false }, seating_id: 'S7' }),
      tile('F8', { state: 'NEEDS_CLEANING', holder: ALI, seating_id: 'S8' }),
      tile('F20', { state: 'BILL_REQUESTED', holder: SARA, bill_requested_at: NOW - 60_000 }),
    ];
    const items = base({ tiles, late: new Map([['F4', 6]]) });
    expect(items.map((i) => `${i.table_id}:${i.kind}`)).toEqual(['F6:bill', 'F4:late', 'F8:clean', 'F7:ordering']);
    expect(items[0]).toMatchObject({ minutes: 4, mine: true });
    expect(items[1]).toMatchObject({ minutes: 6 });
    expect(items[3]).toMatchObject({ who: 'Bilal' });
  });

  it('[02a §8 Table map] waiter (no take-order): no New order; Needs you = calls and cleaning', () => {
    const tiles = [
      tile('F6', { state: 'BILL_REQUESTED', holder: ALI, bill_requested_at: NOW - 60_000 }),
      tile('F8', { state: 'NEEDS_CLEANING' }),
      tile('F4', { state: 'ORDERED', holder: ALI }),
    ];
    const calls = [{ table_id: 'F4', requester: 'Ali', raised_at: NOW - 2 * 60_000, alert_id: 'C1' }];
    const items = base({ role: 'waiter', staffId: 'ST-RASHID', tiles, late: new Map([['F4', 6]]), calls });
    expect(items.map((i) => `${i.table_id}:${i.kind}`)).toEqual(['F4:call', 'F8:clean']);
  });

  it('[02a §8 Table map] cashier kiosk: every Bill asked and every table to clean', () => {
    const tiles = [
      tile('F6', { state: 'BILL_REQUESTED', holder: ALI, bill_requested_at: NOW - 4 * 60_000 }),
      tile('F8', { state: 'NEEDS_CLEANING' }),
      tile('F1'),
    ];
    const items = base({ role: 'cashier', staffId: 'ST-SANA', tiles });
    expect(items.map((i) => `${i.table_id}:${i.kind}`)).toEqual(['F6:bill', 'F8:clean']);
    expect(items[0]).toMatchObject({ mine: false, who: 'Ali' });
  });
});
