import { availableStock, canServeFromStock, dayDraws, initialEngineState, stockLevel, type EngineState, type StockEntry } from '@pos/engine';
import {
  AddPrecookedStockResult,
  AdminAuthResponse,
  AdminRosterResponse,
  CloseBusinessDayResult,
  commandResponse,
  OpenBusinessDayResult,
  SetItemAvailabilityResult,
  SetPrecookedStockResult,
  StockQueryResponse,
  type BranchConfig,
  type ConfigStockItem,
} from '@pos/events';
import { aBranchConfig, aBranchConfigItemStock } from '@pos/events/testing';
import { afterEach, describe, expect, it } from 'vitest';
import { swapBranchConfig } from '../../src/sync/branch-config-holder';
import { foldEngineEvents } from '../../src/sync/boot-steps';
import { setStockVersion } from '../../src/sync/stock-version';
import { aDirectory, PIN } from '../helpers/fixtures';
import { statementCounter } from '../helpers/statement-counter';
import { createTestHub, openSession, pairDevice, seedDirectory, type TestHub } from '../helpers/test-hub';

type Admin = { device: { deviceId: string; token: string }; session: { sessionId: string; token: string } };
type ItemRow = { item_id: string; stock_item_ids: string[]; is_available: boolean; unavailable_since: number | null };
type MetaRow = { item_id: string; stock_item_ids: string[] };
// 01c §6.21: the item rows keep availability only (no unit or number fields).
const UNIT_FIELDS = ['stock_unit', 'sale_unit', 'stock_per_sale_unit', 'low_stock_threshold', 'carries_over'];
const NUMBER_FIELDS = ['on_hand', 'reserved', 'unit', 'available', 'level', 'set_at'];
type StockRow = { stock_item_id: string; on_hand: number; reserved: number; unit: string; available: number; level: string; set_at: number | null };
type Drawer = { item_id: string; name: string; variant_name: string | null; sale_unit: string; quantity_per_sale_unit: number };
type StockMetaRow = { stock_item_id: string; stock_unit: string; has_tracked_drawers: boolean; drawers: Drawer[] };

const cleanups: Array<() => Promise<void>> = [];

describe('GET /admin/queries/stock (§6.19)', () => {
  afterEach(async () => {
    for (const cleanup of cleanups.splice(0)) await cleanup();
  });

  it('[01a §10 #72] stock query is 1 statement; set_at from EngineState.stock = the latest StockSet recorded_at; available with business_day_started_at; no config → items [], stock [], 0 statements', async () => {
    const empty = await open(at(25, 6));
    const emptyAdmin = adminOn(empty, 'S_MGR');
    const counter0 = statementCounter(empty.deps.readDb);
    const none = await query(empty, emptyAdmin);
    expect(none.statusCode).toBe(200);
    expect(none.json().data).toMatchObject({
      config_version: null,
      stock_items_meta: [],
      stock: [],
      items_meta: [],
      items: [],
      business_day: null,
      business_day_started_at: null,
    });
    expect(counter0.count).toBe(0);

    const hub = await open(at(25, 6));
    withConfig(aBranchConfigItemStock());
    const admin = adminOn(hub, 'S_MGR');
    await openDay(hub, admin, 'cmd-open');
    hub.clock.set(at(25, 7));
    await count(hub, admin, [{ stock_item_id: 'I1', on_hand: 6 }], 'cmd-count-1');
    hub.clock.set(at(25, 8));
    await count(hub, admin, [{ stock_item_id: 'I1', on_hand: 5 }], 'cmd-count-2');
    hub.clock.set(at(25, 9));

    const counter = statementCounter(hub.deps.readDb);
    const res = await query(hub, admin);
    expect(res.statusCode).toBe(200);
    expect(counter.count).toBe(1);
    const data = res.json().data;
    expect(data.business_day_started_at).toBe(at(25, 6));
    // 01c §6.21: the numbers per stock item (I1 and I3, by name); the item rows keep availability.
    const i1 = stockRow(data.stock, 'I1');
    const latest = lastRecordedAt(hub, 'StockSet');
    expect(i1).toEqual({ stock_item_id: 'I1', on_hand: 5, reserved: 0, unit: 'piece', available: 5, level: 'ok', set_at: latest });
    expect(i1.set_at).toBe(engine(hub).stock.I1!.set_at);
    expect(i1.available).toBe(availableStock(engine(hub), 'I1', at(25, 6), stockItem(aBranchConfigItemStock(), 'I1')));
    expect(data.stock.map((r: StockRow) => r.stock_item_id)).toEqual(['I1', 'I3']);
    expect(row(data.items, 'I1')).toEqual({ item_id: 'I1', stock_item_ids: ['I1'], is_available: true, unavailable_since: null });
    for (const r of data.items as ItemRow[]) for (const field of NUMBER_FIELDS) expect(r).not.toHaveProperty(field);
    expect(row(data.items, 'I2')).toMatchObject({ stock_item_ids: [] });
    expect(data.items.map((r: ItemRow) => r.item_id)).toEqual(['I1', 'I2', 'I3']);
  });

  it('[01a §10 #103] unavailable_since: off yesterday 22:00 before a 05:00 open → yesterday 22:00; off today 06:00 → today 06:00; available → null', async () => {
    const hub = await open(at(24, 22));
    withConfig(aBranchConfigItemStock());
    const admin = adminOn(hub, 'S_MGR');
    expect((await toggle(hub, admin, 'I2', false, 'cmd-off-2')).statusCode).toBe(200);
    hub.clock.set(at(25, 5));
    await openDay(hub, admin, 'cmd-open');
    hub.clock.set(at(25, 6));
    expect((await toggle(hub, admin, 'I1', false, 'cmd-off-1')).statusCode).toBe(200);

    const data = (await query(hub, admin)).json().data;
    expect(row(data.items, 'I2')).toMatchObject({ is_available: false, unavailable_since: at(24, 22) });
    expect(row(data.items, 'I1')).toMatchObject({ is_available: false, unavailable_since: at(25, 6) });
    expect(row(data.items, 'I3')).toMatchObject({ is_available: true, unavailable_since: null });
    expect(data.business_day_started_at).toBe(at(25, 5));
  });

  it('[01a §10 #116] a non-carrying count from yesterday reads available 0 after the next open, on_hand kept; a new count reads 4', async () => {
    const config = aBranchConfigItemStock();
    const i1 = stockItem(config, 'I1');
    const entry = (setAt: number | null): StockEntry => ({ on_hand: 4, reserved: 1, set_at: setAt, unit: 'piece' });
    const state = (setAt: number | null, start: number | null): EngineState => ({
      ...initialEngineState(),
      stock: { I1: entry(setAt) },
      business_day: start === null ? null : { business_date: '2026-10-25', opened_at: start, closed_at: null, stock_units: {}, draws: {} },
    });
    expect(availableStock(state(at(25, 8), at(25, 9)), 'I1', at(25, 9), i1)).toBe(0);
    expect(availableStock(state(at(25, 9), at(25, 9)), 'I1', at(25, 9), i1)).toBe(3);
    expect(availableStock(state(null, at(25, 9)), 'I1', at(25, 9), i1)).toBe(0);
    expect(availableStock(state(at(25, 9), null), 'I1', null, i1)).toBe(0);

    const hub = await open(at(24, 10));
    withConfig(config);
    const admin = adminOn(hub, 'S_MGR');
    await openDay(hub, admin, 'cmd-open-24');
    hub.clock.set(at(24, 23));
    await count(hub, admin, [{ stock_item_id: 'I1', on_hand: 4 }], 'cmd-count-24');
    hub.clock.set(at(24, 23, 30));
    await closeDay(hub, admin, 'cmd-close-24');
    hub.clock.set(at(25, 9));
    await openDay(hub, admin, 'cmd-open-25');

    const before = stockRow((await query(hub, admin)).json().data.stock, 'I1');
    expect(before).toMatchObject({ on_hand: 4, available: 0, level: 'not_counted', set_at: at(24, 23) });
    hub.clock.set(at(25, 9, 5));
    await count(hub, admin, [{ stock_item_id: 'I1', on_hand: 4 }], 'cmd-count-25');
    const after = stockRow((await query(hub, admin)).json().data.stock, 'I1');
    expect(after).toMatchObject({ on_hand: 4, available: 4, level: 'ok' });
  });

  it('[01a §10 #131] a carrying item counted yesterday 23:00 keeps its stock after a 09:00 open; a non-carrying one reads 0 and not_counted', async () => {
    const config = carrying(aBranchConfigItemStock(), 'I3');
    const hub = await open(at(24, 10));
    withConfig(config);
    const admin = adminOn(hub, 'S_MGR');
    await openDay(hub, admin, 'cmd-open-24');
    hub.clock.set(at(24, 23));
    await count(hub, admin, [{ stock_item_id: 'I1', on_hand: 4 }, { stock_item_id: 'I3', on_hand: 2_000 }], 'cmd-count-24');
    hub.clock.set(at(24, 23, 30));
    await closeDay(hub, admin, 'cmd-close-24');
    hub.clock.set(at(25, 9));
    await openDay(hub, admin, 'cmd-open-25');

    const data = (await query(hub, admin)).json().data;
    expect(stockRow(data.stock, 'I3')).toMatchObject({ on_hand: 2_000, available: 2_000, level: 'ok' });
    expect(stockRow(data.stock, 'I1')).toMatchObject({ on_hand: 4, available: 0, level: 'not_counted' });
    expect(stockMeta(data.stock_items_meta, 'I3')).toMatchObject({ carries_over: true });
    expect(availableStock(engine(hub), 'I3', at(25, 9), stockItem(config, 'I3'))).toBe(2_000);
  });

  it('[01a §10 #132] stockLevel not_counted / out / low / ok, and the stock query carries level', async () => {
    const base = aBranchConfigItemStock();
    const config: BranchConfig = {
      ...base,
      stock_items: base.stock_items.map((s) => (s.stock_item_id === 'I3' ? { ...s, low_stock_threshold: 1_000 } : s)),
    };
    const hub = await open(at(25, 6));
    withConfig(config);
    const admin = adminOn(hub, 'S_MGR');
    await openDay(hub, admin, 'cmd-open');
    let data = (await query(hub, admin)).json().data;
    // 01c §6.21: the level is on the stock item's row (I1 and I3).
    expect(stockRow(data.stock, 'I1').level).toBe('not_counted');
    expect(stockRow(data.stock, 'I3').level).toBe('not_counted');
    expect(row(data.items, 'I1')).not.toHaveProperty('level');

    hub.clock.set(at(25, 7));
    await count(hub, admin, [{ stock_item_id: 'I1', on_hand: 0 }, { stock_item_id: 'I3', on_hand: 1_000 }], 'cmd-count-1');
    data = (await query(hub, admin)).json().data;
    expect(stockRow(data.stock, 'I1').level).toBe('out');
    expect(stockRow(data.stock, 'I3').level).toBe('low');

    hub.clock.set(at(25, 8));
    await count(hub, admin, [{ stock_item_id: 'I1', on_hand: 1 }, { stock_item_id: 'I3', on_hand: 1_001 }], 'cmd-count-2');
    data = (await query(hub, admin)).json().data;
    expect(stockRow(data.stock, 'I1').level).toBe('ok');
    expect(stockRow(data.stock, 'I3').level).toBe('ok');
    expect(stockRow(data.stock, 'I1').level).toBe(stockLevel(engine(hub), 'I1', at(25, 6), stockItem(config, 'I1')));
  });

  it('[01a §10 #142] past midnight the open day stays open: OpenBusinessDay is a no-op, yesterday 23:00 count still reads, day_stale true at 18.5 h', async () => {
    const hub = await open(at(24, 6));
    withConfig(aBranchConfigItemStock());
    const admin = adminOn(hub, 'S_MGR');
    await openDay(hub, admin, 'cmd-open-24');
    hub.clock.set(at(24, 23));
    await count(hub, admin, [{ stock_item_id: 'I1', on_hand: 5 }], 'cmd-count');
    hub.clock.set(at(25, 0, 30));

    const again = await openDay(hub, admin, 'cmd-open-25');
    expect(again).toEqual({ business_date: '2026-10-24', opened_at: at(24, 6), changed: false, reason: 'already_open' });
    expect(dayEvents(hub, 'BusinessDayOpened')).toBe(1);

    const data = (await query(hub, admin)).json().data;
    expect(data.business_day).toEqual({ business_date: '2026-10-24', opened_at: at(24, 6), closed_at: null });
    expect(data.hub_local_date).toBe('2026-10-25');
    expect(data.day_stale).toBe(true);
    expect(data.day_stale_after_hours).toBe(16);
    expect(stockRow(data.stock, 'I1')).toMatchObject({ on_hand: 5, available: 5, level: 'ok' });
    expect(engine(hub).business_day?.closed_at).toBeNull();
  });

  it('[01a §10 #146] day_stale: false at exactly 16 h, true at 16 h 1 min, false with day_stale_after_hours 20', async () => {
    const hub = await open(at(24, 9));
    withConfig(aBranchConfigItemStock());
    const admin = adminOn(hub, 'S_MGR');
    await openDay(hub, admin, 'cmd-open');

    hub.clock.set(at(25, 1));
    expect((await query(hub, admin)).json().data.day_stale).toBe(false);
    hub.clock.set(at(25, 1, 1));
    expect((await query(hub, admin)).json().data.day_stale).toBe(true);
    withConfig(aBranchConfigItemStock({ config_version: 2, day_stale_after_hours: 20 }));
    const data = (await query(hub, admin)).json().data;
    expect(data.day_stale).toBe(false);
    expect(data.day_stale_after_hours).toBe(20);
  });

  it('[01a §10 #152] stock poll versions: parts sent only when their version moved; unchanged is 0 statements; restart keeps stock_version', async () => {
    const hub = await open(at(25, 6));
    withConfig(aBranchConfigItemStock());
    const admin = adminOn(hub, 'S_MGR');
    await openDay(hub, admin, 'cmd-open');
    const counter = statementCounter(hub.deps.readDb);

    counter.reset();
    let data = (await query(hub, admin)).json().data;
    expect(data.unchanged).toBe(false);
    expect(data.items_meta).not.toBeNull();
    expect(data.items).not.toBeNull();
    expect(data.stock_items_meta).not.toBeNull();
    expect(data.stock).not.toBeNull();
    expect(counter.count).toBe(1);
    expect(data.meta_version).toBe(`1.${at(25, 6)}`);
    expect(data.stock_version).toBe(lastSeq(hub, 'BusinessDayOpened'));
    let versions = { meta_version: data.meta_version as string, stock_version: data.stock_version as number };

    counter.reset();
    data = (await query(hub, admin, versions)).json().data;
    expect(data).toMatchObject({ unchanged: true, stock_items_meta: null, stock: null, items_meta: null, items: null, ...versions });
    expect(counter.count).toBe(0);

    hub.clock.set(at(25, 7));
    await count(hub, admin, [{ stock_item_id: 'I1', on_hand: 3 }], 'cmd-count');
    counter.reset();
    data = (await query(hub, admin, versions)).json().data;
    expect(data.unchanged).toBe(false);
    expect(data.stock_version).toBe(lastSeq(hub, 'StockSet'));
    expect(data.meta_version).toBe(versions.meta_version);
    expect(data.items_meta).toBeNull();
    expect(data.stock_items_meta).toBeNull();
    expect(stockRow(data.stock, 'I1').on_hand).toBe(3);
    expect(counter.count).toBe(1);
    versions = { meta_version: data.meta_version, stock_version: data.stock_version };

    withConfig(aBranchConfigItemStock({ config_version: 2 }));
    counter.reset();
    data = (await query(hub, admin, versions)).json().data;
    expect(data.meta_version).toBe(`2.${at(25, 6)}`);
    expect(data.stock_version).toBe(versions.stock_version);
    expect(data.items_meta).not.toBeNull();
    expect(data.items).not.toBeNull();
    expect(data.stock_items_meta).not.toBeNull();
    expect(data.stock).not.toBeNull();
    expect(counter.count).toBe(1);
    versions = { meta_version: data.meta_version, stock_version: data.stock_version };

    hub.clock.set(at(25, 8));
    expect((await toggle(hub, admin, 'I2', false, 'cmd-off')).statusCode).toBe(200);
    data = (await query(hub, admin, versions)).json().data;
    expect(data.stock_version).toBe(lastSeq(hub, 'ItemMadeUnavailable'));
    expect(row(data.items, 'I2').is_available).toBe(false);
    versions = { meta_version: data.meta_version, stock_version: data.stock_version };

    hub.clock.set(at(25, 23));
    await closeDay(hub, admin, 'cmd-close');
    data = (await query(hub, admin, versions)).json().data;
    expect(data.stock_version).toBe(lastSeq(hub, 'BusinessDayClosed'));
    expect(data.items).not.toBeNull();
    expect(data.stock).not.toBeNull();
    versions = { meta_version: data.meta_version, stock_version: data.stock_version };

    hub.clock.set(at(26, 6));
    await openDay(hub, admin, 'cmd-open-26');
    counter.reset();
    data = (await query(hub, admin, versions)).json().data;
    expect(data.meta_version).toBe(`2.${at(26, 6)}`);
    expect(data.meta_version).not.toBe(versions.meta_version);
    expect(data.stock_version).toBe(lastSeq(hub, 'BusinessDayOpened'));
    expect(data.stock_version).not.toBe(versions.stock_version);
    expect(data.items_meta).not.toBeNull();
    expect(data.items).not.toBeNull();
    expect(counter.count).toBe(1);
    const lastStockSeq = data.stock_version as number;

    // Restart: the boot step 3 fold sets stock_version from the log (the real boot() path is #147's setup).
    setStockVersion(0);
    setStockVersion(foldEngineEvents(hub.deps.db, 'branch-1').stockVersion);
    data = (await query(hub, admin)).json().data;
    expect(data.stock_version).toBe(lastStockSeq);
  });

  it('[01a S44] after a unit change mid-day the query shows the frozen unit and quantity_per_sale_unit', async () => {
    const hub = await open(at(25, 6));
    withConfig(aBranchConfigItemStock());
    const admin = adminOn(hub, 'S_MGR');
    await openDay(hub, admin, 'cmd-open');
    hub.clock.set(at(25, 7));
    await count(hub, admin, [{ stock_item_id: 'I1', on_hand: 6 }], 'cmd-count');
    withConfig(withUnits(aBranchConfigItemStock({ config_version: 2 }), { I1: { stock_unit: 'g', quantity_per_sale_unit: 250 } }));

    const data = (await query(hub, admin)).json().data;
    expect(stockMeta(data.stock_items_meta, 'I1')).toMatchObject({
      stock_unit: 'piece',
      drawers: [{ item_id: 'I1', sale_unit: 'piece', quantity_per_sale_unit: 1 }],
    });
    expect(stockRow(data.stock, 'I1')).toMatchObject({ unit: 'piece', on_hand: 6, available: 6 });
  });

  it('[01a §10 #158] items[].unit is the open day\'s frozen unit, else the config\'s; a count in another unit reads as no count', async () => {
    const hub = await open(at(25, 6));
    withConfig(aBranchConfigItemStock());
    const admin = adminOn(hub, 'S_MGR');
    await openDay(hub, admin, 'cmd-open-1');
    hub.clock.set(at(25, 7));
    await count(hub, admin, [{ stock_item_id: 'I1', on_hand: 6 }], 'cmd-count');
    hub.clock.set(at(25, 23));
    await closeDay(hub, admin, 'cmd-close');
    const base = aBranchConfigItemStock({ config_version: 2 });
    // I2 becomes stock-tracked (a stock time and a draw from its own stock item, counted in g).
    const tracked: BranchConfig = {
      ...base,
      stock_items: [...base.stock_items, { ...base.stock_items[0]!, stock_item_id: 'I2', name: 'Mutton Karahi' }],
      items: base.items.map((i) => (i.item_id === 'I2' ? { ...i, stock_time_ms: 300_000 } : i)),
    };
    withConfig(withUnits(tracked, { I1: { stock_unit: 'g', quantity_per_sale_unit: 250 }, I2: { stock_unit: 'g', quantity_per_sale_unit: 250 } }));

    // No day open: the stock item's unit.
    const closed = (await query(hub, admin)).json().data;
    expect(stockRow(closed.stock, 'I2')).toMatchObject({ unit: 'g' });
    expect(stockRow(closed.stock, 'I1')).toMatchObject({ unit: 'g', on_hand: 0, reserved: 0, set_at: null });

    hub.clock.set(at(26, 6));
    await openDay(hub, admin, 'cmd-open-2');
    const data = (await query(hub, admin)).json().data;
    // Never counted: the frozen day unit, not stockOf's 'piece' default.
    expect(stockRow(data.stock, 'I2')).toMatchObject({ unit: 'g', on_hand: 0, set_at: null });
    expect(stockMeta(data.stock_items_meta, 'I2')).toMatchObject({ stock_unit: 'g' });
    // Counted in piece yesterday; the day is in g: no count.
    expect(stockRow(data.stock, 'I1')).toMatchObject({ unit: 'g', on_hand: 0, reserved: 0, set_at: null, available: 0, level: 'not_counted' });
    expect(engine(hub).stock['I1']).toMatchObject({ unit: 'piece', on_hand: 6 });
  });

  it('[01a §10 #156] items_meta carries category_name; the answer carries day_min_gap_hours (4 with no config)', async () => {
    const hub = await open(at(25, 6));
    const admin = adminOn(hub, 'S_MGR');
    expect((await query(hub, admin)).json().data.day_min_gap_hours).toBe(4);

    const base = aBranchConfigItemStock();
    withConfig({ ...base, day_min_gap_hours: 2 });
    const data = (await query(hub, admin)).json().data;
    expect(data.day_min_gap_hours).toBe(2);
    for (const meta of data.items_meta as Array<{ category_id: string; category_name: string; stock_item_ids: string[] }>) {
      expect(meta.category_name).toBe(base.categories.find((c) => c.category_id === meta.category_id)?.name);
      // 01c §6.21: no unit fields; the stock items the item draws from.
      expect(Array.isArray(meta.stock_item_ids)).toBe(true);
      for (const field of UNIT_FIELDS) expect(meta).not.toHaveProperty(field);
    }
    expect(StockQueryResponse.parse((await query(hub, admin)).json()).data.day_min_gap_hours).toBe(2);
  });

  it('[01c #70] stock query: one row per stock item with its drawers; 1 statement when the numbers are sent; no deal rows', async () => {
    const config = aBranchConfig();
    const deal = {
      deal_id: 'D1',
      category_id: 'C1',
      name: 'Karahi deal',
      description: null,
      sort_order: 1,
      price_minor: 300_000,
      tax_class_id: null,
      availability_windows: [],
      parts: [{ deal_part_id: 'P1', quantity: 1, sort_order: 1, choices: [{ item_id: 'I1', extra_price_minor: 0, sort_order: 1 }] }],
    };
    const hub = await open(at(25, 6));
    withConfig({ ...config, deals: [deal] });
    const admin = adminOn(hub, 'S_MGR');
    await openDay(hub, admin, 'cmd-open');
    hub.clock.set(at(25, 7));
    await count(hub, admin, [{ stock_item_id: 'K1', on_hand: 6_000 }], 'cmd-count');

    const counter = statementCounter(hub.deps.readDb);
    const data = (await query(hub, admin)).json().data;
    expect(counter.count).toBe(1);
    expect(data.stock_items_meta).toEqual([
      {
        stock_item_id: 'K1',
        name: 'Karahi pot',
        stock_unit: 'g',
        carries_over: false,
        station_id: 'S1',
        low_stock_threshold: null,
        has_tracked_drawers: true,
        drawers: [
          { item_id: 'I1', name: 'Chicken Karahi — Half', variant_name: 'Half', sale_unit: 'piece', quantity_per_sale_unit: 500 },
          { item_id: 'I3', name: 'Chicken Karahi — Full', variant_name: 'Full', sale_unit: 'piece', quantity_per_sale_unit: 1_000 },
        ],
      },
    ]);
    expect(data.stock).toEqual([
      { stock_item_id: 'K1', on_hand: 6_000, reserved: 0, unit: 'g', available: 6_000, level: 'ok', set_at: lastRecordedAt(hub, 'StockSet') },
    ]);
    expect(data.items.map((r: { item_id: string; stock_item_ids: string[] }) => [r.item_id, r.stock_item_ids])).toEqual([
      ['I1', ['K1']],
      ['I2', []],
      ['I3', ['K1']],
    ]);
    expect(data.items_meta.map((r: { item_id: string; stock_item_ids: string[] }) => [r.item_id, r.stock_item_ids])).toEqual([
      ['I1', ['K1']],
      ['I2', []],
      ['I3', ['K1']],
    ]);
    // No deal rows (v0.3, m9).
    expect(JSON.stringify(data)).not.toContain('D1');
    expect(StockQueryResponse.parse({ data })).toEqual({ data });
  });

  // F4: the cloud builder leaves out items not routed at this branch (01c #80), so a stock item counted here whose
  // only drawer is routed elsewhere reaches the hub with no item drawing from it.
  const fishTray: ConfigStockItem = { stock_item_id: 'K2', name: 'Fish tray', stock_unit: 'piece', carries_over: false, station_id: 'S1', low_stock_threshold: null };
  const friedFish = (o: Partial<BranchConfig['items'][number]>) => ({ ...item(aBranchConfig(), 'I2'), item_id: 'I4', name: 'Fried fish', sort_order: 4, ...o });

  it('[01c #82] a stock item counted here whose only drawer is not routed here → has_tracked_drawers: false; once the drawer is routed with a stock time → true', async () => {
    const base = aBranchConfig();
    const hub = await open(at(25, 6));
    withConfig({ ...base, stock_items: [...base.stock_items, fishTray] });
    const admin = adminOn(hub, 'S_MGR');
    await openDay(hub, admin, 'cmd-open');
    const before = (await query(hub, admin)).json().data;
    expect(stockMeta(before.stock_items_meta, 'K2')).toMatchObject({ has_tracked_drawers: false, drawers: [] });
    expect(stockMeta(before.stock_items_meta, 'K1')).toMatchObject({ has_tracked_drawers: true });

    // The next snapshot: the drawer is now routed here with a stock time, so the builder lists it with its draw.
    hub.clock.set(at(25, 7));
    withConfig({
      ...base,
      config_version: 2,
      stock_items: [...base.stock_items, fishTray],
      items: [...base.items, friedFish({ stock_time_ms: 300_000, stock_draws: [{ stock_item_id: 'K2', quantity_per_sale_unit: 1 }] })],
    });
    const after = (await query(hub, admin)).json().data;
    expect(stockMeta(after.stock_items_meta, 'K2')).toMatchObject({
      has_tracked_drawers: true,
      drawers: [{ item_id: 'I4', name: 'Fried fish', variant_name: null, sale_unit: 'piece', quantity_per_sale_unit: 1 }],
    });
  });

  it('[01c §6.21] Review Focus 4: SetPrecookedStock on a stock item nothing sold here draws from → 200, one StockSet v2; the row stays on the page', async () => {
    const base = aBranchConfig();
    const hub = await open(at(25, 6));
    withConfig({ ...base, stock_items: [...base.stock_items, fishTray] });
    const admin = adminOn(hub, 'S_MGR');
    await openDay(hub, admin, 'cmd-open');
    hub.clock.set(at(25, 7));
    const res = await command(hub, admin, 'set-precooked-stock', 'SetPrecookedStock', { entries: [{ stock_item_id: 'K2', on_hand: 12 }] }, 'cmd-count-k2');
    expect(res.statusCode, res.body).toBe(200);
    const events = hub.deps.db
      .prepare("SELECT event_type, schema_version, stream_id, payload FROM events WHERE stream_type = 'stock' ORDER BY seq")
      .all() as Array<{ event_type: string; schema_version: number; stream_id: string; payload: string }>;
    expect(events.map((e) => ({ ...e, payload: JSON.parse(e.payload) as unknown }))).toEqual([
      { event_type: 'StockSet', schema_version: 2, stream_id: 'K2', payload: { stock_item_id: 'K2', on_hand: 12, unit: 'piece' } },
    ]);
    const data = (await query(hub, admin)).json().data;
    expect(stockMeta(data.stock_items_meta, 'K2')).toMatchObject({ has_tracked_drawers: false, drawers: [] });
    expect(stockRow(data.stock, 'K2')).toMatchObject({ on_hand: 12, unit: 'piece', available: 12, level: 'ok', set_at: at(25, 7) });
  });

  it('[01c #114] hub upgraded while a v1 day is open: the fold gives the upcast draws; the query shows the frozen units; canServeFromStock uses the upcast quantity_per_sale_unit', async () => {
    const hub = await open(at(25, 6));
    withConfig(aBranchConfigItemStock());
    const admin = adminOn(hub, 'S_MGR');
    // The rows an 01a hub stored (the writer now upcasts on append, so insert them raw).
    const units = {
      I1: { stock_unit: 'piece', sale_unit: 'piece', stock_per_sale_unit: 1 },
      I3: { stock_unit: 'g', sale_unit: 'piece', stock_per_sale_unit: 250 },
    };
    insertV1(hub, 'hub', 'branch-1', 'BusinessDayOpened', { business_date: '2026-10-25', units }, at(25, 6));
    insertV1(hub, 'stock', 'I3', 'StockSet', { item_id: 'I3', on_hand: 1_000, unit: 'g' }, at(25, 7));
    // The upgraded hub's boot step 3 (the real boot() path is #147's setup).
    hub.deps.state.swap(foldEngineEvents(hub.deps.db, 'branch-1').state);
    expect(engine(hub).business_day).toMatchObject({
      stock_units: { I1: 'piece', I3: 'g' },
      draws: { I3: { sale_unit: 'piece', stock_draws: [{ stock_item_id: 'I3', quantity_per_sale_unit: 250 }] } },
    });

    // The config moves mid-day: I1 to g, I3 to 300 g a piece; the open day keeps the frozen values.
    hub.clock.set(at(25, 8));
    const base = aBranchConfigItemStock({ config_version: 2 });
    withConfig(withUnits(base, { I1: { stock_unit: 'g', quantity_per_sale_unit: 250 }, I3: { quantity_per_sale_unit: 300 } }));
    const data = (await query(hub, admin)).json().data;
    expect(stockMeta(data.stock_items_meta, 'I1')).toMatchObject({
      stock_unit: 'piece',
      drawers: [{ item_id: 'I1', name: 'Chicken Karahi', variant_name: null, sale_unit: 'piece', quantity_per_sale_unit: 1 }],
    });
    const i3 = stockMeta(data.stock_items_meta, 'I3');
    expect(i3).toMatchObject({ stock_unit: 'g', drawers: [{ item_id: 'I3', sale_unit: 'piece', quantity_per_sale_unit: 250 }] });
    const stock = stockRow(data.stock, 'I3');
    expect(stock).toMatchObject({ on_hand: 1_000, unit: 'g', available: 1_000, level: 'ok', set_at: at(25, 7) });
    const perSale = i3.drawers[0]!.quantity_per_sale_unit;
    expect(canServeFromStock(stock.available, 4, perSale)).toBe(true);
    expect(canServeFromStock(stock.available, 5, perSale)).toBe(false);
    expect(dayDraws(engine(hub), item(base, 'I3'), { I3: 'g' }).stock_draws).toEqual([{ stock_item_id: 'I3', quantity_per_sale_unit: 250 }]);
  });

  it('[01a §6.19] an admin without manage-stock → 403', async () => {
    const hub = await open(at(25, 6));
    withConfig(aBranchConfigItemStock());
    const owner = adminOn(hub, 'S_OWNER');
    const res = await query(hub, owner);
    expect(res.statusCode).toBe(403);
    expect(res.json().error.code).toBe('PERMISSION_DENIED');
    expect(res.json().error.details).toMatchObject({ permission: 'manage-stock' });
  });

  it('[01a §6.19] items_meta carries the snapshot fields in config order, with item and category windows', async () => {
    const base = aBranchConfigItemStock();
    const window = { start_ms: 43_200_000, end_ms: 54_000_000 };
    const config: BranchConfig = {
      ...base,
      categories: base.categories.map((c) => ({ ...c, availability_windows: [window] })),
      items: base.items.map((i) => (i.item_id === 'I2' ? { ...i, availability_windows: [window] } : i)),
    };
    const hub = await open(at(25, 6));
    withConfig(config);
    const admin = adminOn(hub, 'S_MGR');
    const data = (await query(hub, admin)).json().data;
    expect(data.items_meta.map((m: MetaRow) => m.item_id)).toEqual(['I1', 'I2', 'I3']);
    const i2 = item(config, 'I2');
    expect(row(data.items_meta, 'I2')).toEqual({
      item_id: 'I2',
      name: i2.name,
      group_label: null,
      category_id: i2.category_id,
      category_name: config.categories.find((c) => c.category_id === i2.category_id)?.name,
      is_stock_tracked: false,
      out_of_stock_behaviour: i2.out_of_stock_behaviour,
      stock_item_ids: [],
      item_windows: [window],
      category_windows: [window],
    });
    expect(row(data.items_meta, 'I1')).toMatchObject({ is_stock_tracked: true, item_windows: [] });
    expect(data.hub_time).toEqual({ now_ms: at(25, 6), utc_offset_ms: -new Date(at(25, 6)).getTimezoneOffset() * 60_000 });
    expect(data).not.toHaveProperty('in_window');
  });

  it('[01c §6.21 AD-17] items_meta.group_label is the item\'s variant group name; a plain item has null', async () => {
    const hub = await open(at(25, 6));
    withConfig(aBranchConfig());
    const admin = adminOn(hub, 'S_MGR');
    const data = (await query(hub, admin)).json().data;
    expect(row(data.items_meta, 'I1')).toMatchObject({ group_label: 'Chicken Karahi' });
    expect(row(data.items_meta, 'I3')).toMatchObject({ group_label: 'Chicken Karahi' });
    expect(row(data.items_meta, 'I2')).toMatchObject({ group_label: null });
  });

  it('[01a §7.7, D5] real stock, command and admin login answers parse with the shared @pos/events schemas', async () => {
    const hub = await open(at(25, 6));
    withConfig(aBranchConfigItemStock());
    const admin = adminOn(hub, 'S_MGR');
    const opened = await command(hub, admin, 'open-business-day', 'OpenBusinessDay', {}, 'cmd-d5-open');
    expect(commandResponse(OpenBusinessDayResult).parse(opened.json())).toEqual(opened.json());
    const counted = await command(hub, admin, 'set-precooked-stock', 'SetPrecookedStock', { entries: [{ stock_item_id: 'I1', on_hand: 4 }] }, 'cmd-d5-set');
    expect(commandResponse(SetPrecookedStockResult).parse(counted.json())).toEqual(counted.json());
    const added = await command(hub, admin, 'add-precooked-stock', 'AddPrecookedStock', { entries: [{ stock_item_id: 'I1', quantity: 2 }] }, 'cmd-d5-add');
    expect(commandResponse(AddPrecookedStockResult).parse(added.json())).toEqual(added.json());
    const off = await toggle(hub, admin, 'I2', false, 'cmd-d5-off');
    expect(commandResponse(SetItemAvailabilityResult).parse(off.json())).toEqual(off.json());
    hub.clock.set(at(25, 12));
    const closed = await command(hub, admin, 'close-business-day', 'CloseBusinessDay', {}, 'cmd-d5-close');
    expect(commandResponse(CloseBusinessDayResult).parse(closed.json())).toEqual(closed.json());

    const answer = (await query(hub, admin)).json();
    expect(StockQueryResponse.parse(answer)).toEqual(answer);
    const short = (await query(hub, admin, { meta_version: answer.data.meta_version, stock_version: answer.data.stock_version })).json();
    expect(short.data.unchanged).toBe(true);
    expect(StockQueryResponse.parse(short)).toEqual(short);

    const auth = { authorization: `Bearer ${admin.device.token}` };
    const roster = (await hub.app.inject({ method: 'GET', url: '/admin/login-roster', headers: auth })).json();
    expect(AdminRosterResponse.parse(roster)).toEqual(roster);
    const login = await hub.app.inject({ method: 'POST', url: '/admin/auth', headers: auth, payload: { staff_id: 'S_MGR', pin: PIN.b } });
    expect(login.statusCode).toBe(200);
    expect(AdminAuthResponse.parse(login.json())).toEqual(login.json());
  });
});

// Local wall-clock time on October <day>, 2026 (the hub's zone).
function at(day: number, hours: number, minutes = 0): number {
  return new Date(2026, 9, day, hours, minutes).getTime();
}

function carrying(config: BranchConfig, stockItemId: string): BranchConfig {
  return { ...config, stock_items: config.stock_items.map((s) => (s.stock_item_id === stockItemId ? { ...s, carries_over: true } : s)) };
}

// The 01c §5.1 fixture shape (item X draws from stock item X): a new stock unit and a new draw factor.
function withUnits(
  config: BranchConfig,
  changes: Record<string, { stock_unit?: ConfigStockItem['stock_unit']; quantity_per_sale_unit?: number }>,
): BranchConfig {
  return {
    ...config,
    stock_items: config.stock_items.map((s) => {
      const unit = changes[s.stock_item_id]?.stock_unit;
      return unit === undefined ? s : { ...s, stock_unit: unit };
    }),
    items: config.items.map((i) => {
      const perSale = changes[i.item_id]?.quantity_per_sale_unit;
      return perSale === undefined ? i : { ...i, stock_draws: [{ stock_item_id: i.item_id, quantity_per_sale_unit: perSale }] };
    }),
  };
}

function item(config: BranchConfig, itemId: string) {
  const found = config.items.find((candidate) => candidate.item_id === itemId);
  if (found === undefined) throw new Error(`no item ${itemId}`);
  return found;
}

function stockItem(config: BranchConfig, stockItemId: string): ConfigStockItem {
  const found = config.stock_items.find((candidate) => candidate.stock_item_id === stockItemId);
  if (found === undefined) throw new Error(`no stock item ${stockItemId}`);
  return found;
}

function stockRow(rows: StockRow[], stockItemId: string): StockRow {
  const found = rows.find((r) => r.stock_item_id === stockItemId);
  if (found === undefined) throw new Error(`no stock row ${stockItemId}`);
  return found;
}

function stockMeta(rows: StockMetaRow[], stockItemId: string): StockMetaRow {
  const found = rows.find((r) => r.stock_item_id === stockItemId);
  if (found === undefined) throw new Error(`no stock meta row ${stockItemId}`);
  return found;
}

function insertV1(hub: TestHub, streamType: 'stock' | 'hub', streamId: string, eventType: string, payload: Record<string, unknown>, at: number): void {
  const seq = (hub.deps.db.prepare('SELECT COALESCE(MAX(seq), 0) FROM events').pluck().get() as number) + 1;
  hub.deps.db
    .prepare(
      `INSERT INTO events (event_id, tenant_id, branch_id, stream_type, stream_id, event_type,
         schema_version, payload, occurred_at, recorded_at, actor_id, device_id, seq)
       VALUES (?, 'tenant-a', 'branch-1', ?, ?, ?, 1, ?, ?, ?, NULL, 'hub', ?)`,
    )
    .run(`01J0000000000000000000V1${String(seq).padStart(2, '0')}`, streamType, streamId, eventType, JSON.stringify(payload), at, at, seq);
}

function row<T = ItemRow>(rows: T[], itemId: string): T {
  const found = rows.find((r) => (r as { item_id: string }).item_id === itemId);
  if (found === undefined) throw new Error(`no row ${itemId}`);
  return found;
}

async function open(start: number): Promise<TestHub> {
  const hub = await createTestHub();
  cleanups.push(() => hub.close());
  hub.clock.set(start);
  // These tests move the clock by hours; long idle TTLs keep the admin sessions alive.
  const directory = await aDirectory();
  for (const role of directory.roles) role.session_idle_ttl_ms = 7 * 86_400_000;
  // S_OWNER keeps access-hub-admin but not manage-stock, so the query's own 403 is reached.
  for (const staff of directory.staff) if (staff.staff_id === 'S_OWNER') staff.denied_permissions = ['manage-stock'];
  await seedDirectory(hub, directory);
  return hub;
}

function withConfig(config: BranchConfig): void {
  swapBranchConfig({ config, snapshotHash: 'h'.repeat(64), configVersion: config.config_version, snapshotSchemaVersion: 2, appliedAt: 0 });
}

function adminOn(hub: TestHub, staffId: string): Admin {
  const device = pairDevice(hub, { type: 'tablet' });
  const session = openSession(hub, { kind: 'admin', staffId, deviceId: device.deviceId });
  return { device, session };
}

function query(hub: TestHub, admin: Admin, versions?: { meta_version: string; stock_version: number }) {
  const search = versions === undefined ? '' : `?meta_version=${encodeURIComponent(versions.meta_version)}&stock_version=${versions.stock_version}`;
  return hub.app.inject({
    method: 'GET',
    url: `/admin/queries/stock${search}`,
    headers: { authorization: `Bearer ${admin.device.token}`, 'x-admin-session': admin.session.token },
  });
}

async function command(hub: TestHub, admin: Admin, name: string, commandType: string, payload: Record<string, unknown>, commandId: string) {
  const res = await hub.app.inject({
    method: 'POST',
    url: `/admin/commands/${name}`,
    headers: { authorization: `Bearer ${admin.device.token}`, 'x-admin-session': admin.session.token },
    payload: {
      command_id: commandId,
      tenant_id: 'tenant-a',
      branch_id: 'branch-1',
      command_type: commandType,
      payload,
      occurred_at: hub.clock.branchNow(),
      actor_id: 'S_MGR',
      device_id: admin.device.deviceId,
    },
  });
  return res;
}

async function openDay(hub: TestHub, admin: Admin, commandId: string) {
  const res = await command(hub, admin, 'open-business-day', 'OpenBusinessDay', {}, commandId);
  expect(res.statusCode).toBe(200);
  return res.json().data.result;
}

async function closeDay(hub: TestHub, admin: Admin, commandId: string) {
  const res = await command(hub, admin, 'close-business-day', 'CloseBusinessDay', {}, commandId);
  expect(res.statusCode).toBe(200);
  expect(res.json().data.result.reason).toBe('closed');
}

async function count(hub: TestHub, admin: Admin, entries: Array<{ stock_item_id: string; on_hand: number }>, commandId: string) {
  const res = await command(hub, admin, 'set-precooked-stock', 'SetPrecookedStock', { entries }, commandId);
  expect(res.statusCode).toBe(200);
}

function toggle(hub: TestHub, admin: Admin, itemId: string, isAvailable: boolean, commandId: string) {
  return command(hub, admin, 'set-item-availability', 'SetItemAvailability', { item_id: itemId, is_available: isAvailable }, commandId);
}

function engine(hub: TestHub): EngineState {
  return hub.deps.state.get();
}

function lastSeq(hub: TestHub, eventType: string): number {
  return hub.deps.db.prepare('SELECT MAX(seq) FROM events WHERE event_type = ?').pluck().get(eventType) as number;
}

function lastRecordedAt(hub: TestHub, eventType: string): number {
  return hub.deps.db.prepare('SELECT recorded_at FROM events WHERE event_type = ? ORDER BY seq DESC LIMIT 1').pluck().get(eventType) as number;
}

function dayEvents(hub: TestHub, eventType: string): number {
  return hub.deps.db.prepare('SELECT COUNT(*) FROM events WHERE event_type = ?').pluck().get(eventType) as number;
}
