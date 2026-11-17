import { Banner } from '../../../components/Banner';
import { t } from '../../../i18n';
import { fill } from '../../../i18n/en';
import type { KdsConfig } from './api';

// 03b §3.8, §3.10; 03b-B16 (frame KitchenScreensWarn): the kds-config warnings at the top of the page. Q-48: each
// warning carries the station's `name` (HK6), also for an archived station that `stations[]` leaves out; before
// HK6 an active station is named from `stations[]` and an archived one by its id.
export function warningName(config: KdsConfig, warning: KdsConfig['warnings'][number]): string {
  return warning.name ?? config.stations.find((s) => s.station_id === warning.station_id)?.name ?? warning.station_id;
}

export function Warnings({ config }: { config: KdsConfig }) {
  if (config.warnings.length === 0) return null;
  // Danger (a dark screen) first, then the archived stations.
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
    </div>
  );
}
