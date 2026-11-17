import { t } from '../../../i18n';
import type { KdsApi } from '../contracts';
import { LaneControl, type Lanes } from './LaneControl';

// 03b v1.0.8 §8 (K4; frame 03b-C09): the KDS header — station name, lanes, Live / Reconnecting chip. No staff name
// (station session), no clock (handoff Q-1). Lanes only on a station with lane screens (lane_count > 1) and while
// the day is open.

export function Header({ name, lanes, stationId, api, up, showLanes }: { name: string; lanes: Lanes | null; stationId: string; api: KdsApi; up: boolean; showLanes: boolean }) {
  return (
    <header className="kbar">
      <div className="kbar__st">
        <strong>{name}</strong>
        <span>{t('kds.screen')}</span>
      </div>
      {showLanes && lanes !== null && lanes.lane_count > 1 && <LaneControl lanes={lanes} stationId={stationId} api={api} up={up} />}
      <div className="end">
        <span className={up ? 'live' : 'live off'}>{up ? t('kds.live') : t('kds.reconnecting')}</span>
      </div>
    </header>
  );
}
