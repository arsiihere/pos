import { inAvailabilityWindows, isOrderableByTime, localTimeOfDayMs, type AvailabilityWindow } from '@pos/domain';
import type { HubStockItem, HubStockItemMeta } from '@pos/events';
import { hubDayText, type HubClock } from '../../../app/hub-clock';
import { t } from '../../../i18n';
import { fill } from '../../../i18n/en';

// §8.2: the per-row badges, computed by the page from the query's numbers, the windows and hub_time.
export interface StockRow {
  meta: HubStockItemMeta;
  item: HubStockItem;
}

export interface Badge {
  kind: 'not_counted' | 'hours' | 'off_since';
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

export function rowBadges({ meta, item }: StockRow, startedAt: number | null, clock: HubClock): Badge[] {
  const badges: Badge[] = [];
  // S33, S41: from `level`; the hub never says not_counted for a carrying item with a count in its unit.
  if (meta.is_stock_tracked && item.level === 'not_counted') {
    badges.push({ kind: 'not_counted', tone: 'warn', text: t('admin_stock.badge.not_counted') });
  }
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
