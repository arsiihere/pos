import type { BranchConfig } from '@pos/events';
import { t } from '../../../../i18n';
import { fill } from '../../../../i18n/en';
import type { OrderType } from '../contracts';
import { homeStationId, type StationBand } from '../live/availability';
import type { CartLine } from './cart';

// 02b-TK A2 item 5a (frame CartTimeDelta; CHANGES §3 Cart "a reason line when one item moves it"): the words under the
// line that moved Ready by later — "{item} adds {n} min — the {station} station is full" when its home station's
// stations-live band is red, "… is busy" when amber, else "{item} adds {n} min". A deal names no station.

export function deltaText(config: BranchConfig, line: CartLine, ms: number, order_type: OrderType, band: (station_id: string) => StationBand | null): string {
  const n = String(Math.max(1, Math.round(ms / 60_000)));
  const item = line.item_id === undefined ? undefined : config.items.find((i) => i.item_id === line.item_id);
  const name = line.deal_id !== undefined ? (config.deals.find((d) => d.deal_id === line.deal_id)?.name ?? '') : (item?.name ?? '');
  if (item === undefined) return fill(t('c.delta_plain'), { item: name, n });
  const station_id = homeStationId(config, item.station_id, order_type);
  const station = config.stations.find((s) => s.station_id === station_id)?.name ?? null;
  const b = band(station_id);
  if (station === null || b === null || b === 'green') return fill(t('c.delta_plain'), { item: name, n });
  return fill(t(b === 'red' ? 'c.delta' : 'c.delta_busy'), { item: name, n, station });
}
