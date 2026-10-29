import { inAvailabilityWindows, isOrderableByTime, localTimeOfDayMs, type AvailabilityWindow } from '@pos/domain';
import type { HubStockDrawer, HubStockItem, HubStockItemMeta, HubStockRow, HubStockRowMeta } from '@pos/events';
import { hubDayText, type HubClock } from '../../../app/hub-clock';
import { t } from '../../../i18n';
import { fill } from '../../../i18n/en';

// §8.2: the per-row badges, computed by the page from the query's numbers, the windows and hub_time.

// A menu item's availability row (items_meta, items).
export interface ItemRow {
  meta: HubStockItemMeta;
  item: HubStockItem;
}

// 01c §3.5.4, §8: one row per stock item (count, add, level), its drawers listed under it; a drawer has its
// menu item's row (the Selling switch) when that item is on this page.
export interface StockRow {
  meta: HubStockRowMeta;
  stock: HubStockRow;
  drawers: DrawerRow[];
}

export interface DrawerRow {
  drawer: HubStockDrawer;
  row: ItemRow | null;
}

export interface PageRows {
  stock: StockRow[];
  // The menu items not listed under a stock row: availability only.
  items: ItemRow[];
  // Every menu item row on the page.
  all: ItemRow[];
}

// 01c §6.21: a stock row needs its meta and its numbers; under `my_stations` an item may draw from a stock item
// with no row here, so it stays an availability-only row (never a stock row of its own).
export function pageRows(
  stockMeta: readonly HubStockRowMeta[],
  stock: readonly HubStockRow[],
  itemsMeta: readonly HubStockItemMeta[],
  items: readonly HubStockItem[],
): PageRows {
  const itemById = new Map(items.map((i) => [i.item_id, i]));
  const all: ItemRow[] = itemsMeta.flatMap((meta) => {
    const item = itemById.get(meta.item_id);
    return item === undefined ? [] : [{ meta, item }];
  });
  const rowById = new Map(all.map((r) => [r.meta.item_id, r]));
  const numbers = new Map(stock.map((s) => [s.stock_item_id, s]));
  const stockRows: StockRow[] = stockMeta.flatMap((meta) => {
    const numbersOf = numbers.get(meta.stock_item_id);
    if (numbersOf === undefined) return [];
    return [{ meta, stock: numbersOf, drawers: meta.drawers.map((drawer) => ({ drawer, row: rowById.get(drawer.item_id) ?? null })) }];
  });
  const listed = new Set(stockRows.flatMap((r) => r.drawers.flatMap((d) => (d.row === null ? [] : [d.drawer.item_id]))));
  return { stock: stockRows, items: all.filter((r) => !listed.has(r.meta.item_id)), all };
}

export interface Badge {
  kind: 'not_counted' | 'unused' | 'hours' | 'off_since';
  tone: 'warn' | 'info';
  text: string;
}

function hhmm(msOfDay: number): string {
  const minutes = Math.floor(msOfDay / 60_000);
  return `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
}

export function windowsText(windows: readonly AvailabilityWindow[]): string {
  return windows.map((w) => `${hhmm(w.start_ms)}–${hhmm(w.end_ms)}`).join(', ');
}

// S47: the windows that keep the item out right now (its own first, else its category's), or null when
// it is orderable by time.
export function outsideHours(meta: HubStockItemMeta, clock: HubClock): readonly AvailabilityWindow[] | null {
  const now = clock.nowMs();
  if (isOrderableByTime({ availability_windows: meta.item_windows }, { availability_windows: meta.category_windows }, now, clock.utcOffsetMs)) {
    return null;
  }
  const local = localTimeOfDayMs(now, clock.utcOffsetMs);
  return inAvailabilityWindows(meta.item_windows, local) ? meta.category_windows : meta.item_windows;
}

// S33, S41: from `level`; the hub never says not_counted for a carrying stock item with a count in its unit.
// 01c §6.21 (F4): counted here but nothing sold here draws from it; the count stays allowed.
export function stockBadges({ meta, stock }: StockRow): Badge[] {
  const badges: Badge[] = [];
  if (stock.level === 'not_counted') badges.push({ kind: 'not_counted', tone: 'warn', text: t('admin_stock.badge.not_counted') });
  if (!meta.has_tracked_drawers) badges.push({ kind: 'unused', tone: 'info', text: t('admin_stock.badge.unused') });
  return badges;
}

export function itemBadges({ meta, item }: ItemRow, startedAt: number | null, clock: HubClock): Badge[] {
  const badges: Badge[] = [];
  // S30, S47: a manual Off wins over every window, so an Off item shows Off and no hours badge.
  if (item.is_available) {
    const windows = outsideHours(meta, clock);
    if (windows !== null) {
      badges.push({ kind: 'hours', tone: 'info', text: fill(t('admin_stock.badge.hours'), { hours: windowsText(windows) }) });
    }
  } else if (item.unavailable_since !== null && (startedAt === null || item.unavailable_since < startedAt)) {
    badges.push({
      kind: 'off_since',
      tone: 'warn',
      text: fill(t('admin_stock.badge.off_since'), { day: hubDayText(item.unavailable_since, clock.utcOffsetMs) }),
    });
  }
  return badges;
}
