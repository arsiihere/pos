import { Banner } from '../../../components/Banner';
import { t } from '../../../i18n';
import { fill } from '../../../i18n/en';
import type { KdsConfig, RoutingGap } from './api';

// 03b §3.8, §3.10; 03b-B16 (frame KitchenScreensWarn): the kds-config warnings at the top of the page. Q-48: each
// warning carries the station's `name` (HK6), also for an archived station that `stations[]` leaves out; before
// HK6 an active station is named from `stations[]` and an archived one by its id.
export function warningName(config: KdsConfig, warning: KdsConfig['warnings'][number]): string {
  return warning.name ?? config.stations.find((s) => s.station_id === warning.station_id)?.name ?? warning.station_id;
}

const TYPE_KEY = {
  dine_in: 'owner.points.type.dine_in',
  takeaway: 'owner.points.type.takeaway',
  parking: 'owner.points.type.parking',
} as const;

// 03b v1.0.16 §3.8, §6.12 (run 3 R3-M-2; 01a v2.11 PT-4): one line per routing gap. A fallback names the Pass the
// lines go to; a tie names the tied Passes (from `points`, by id where the hub lists none) and the one used.
export function gapText(config: KdsConfig, gap: RoutingGap): string {
  const type = t(TYPE_KEY[gap.order_type]);
  if (gap.reason === 'fallback') return fill(t('kitchen_screens.gap.fallback'), { type, station: gap.station_name, point: gap.point_name });
  const names = gap.tied_point_ids.map((id) => config.points?.find((p) => p.point_id === id)?.name ?? id);
  return fill(t('kitchen_screens.gap.tie'), { type, station: gap.station_name, n: String(names.length), points: names.join(', '), point: gap.point_name });
}

export function Warnings({ config }: { config: KdsConfig }) {
  // R3-M-8: an older hub omits routing_gaps and shows no routing warning.
  const gaps = config.routing_gaps ?? [];
  if (config.warnings.length === 0 && gaps.length === 0) return null;
  // Danger (a dark screen) first, then the archived stations, then the routing gaps in the hub's order.
  const sorted = [...config.warnings].sort((a, b) => (a.kind === b.kind ? 0 : a.kind === 'dark' ? -1 : 1));
  return (
    <div className="pos-banners">
      {sorted.map((w) =>
        w.kind === 'dark' ? (
          <Banner
            key={`${w.kind}-${w.station_id}`}
            tone="danger"
            text={fill(t('kitchen_screens.warn.dark'), { station: warningName(config, w) })}
            detail={t('kitchen_screens.warn.dark_detail')}
          />
        ) : (
          <Banner
            key={`${w.kind}-${w.station_id}`}
            tone="warn"
            text={fill(t('kitchen_screens.warn.archived_open_lines'), { station: warningName(config, w) })}
            detail={t('kitchen_screens.warn.archived_detail')}
          />
        ),
      )}
      {gaps.map((gap) => (
        <div key={`gap-${gap.station_id}-${gap.order_type}`} data-routing-gap={gap.reason}>
          <Banner tone="warn" text={gapText(config, gap)} detail={t('kitchen_screens.gap.detail')} />
        </div>
      ))}
    </div>
  );
}
