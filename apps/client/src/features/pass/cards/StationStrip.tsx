import { useEffect, useRef, useState } from 'react';
import { t } from '../../../i18n';
import { errorKey, fill } from '../../../i18n/en';
import type { KdsApi, SetLaneStateResult } from '../../kds/contracts';
import { laneTargets, type Lanes } from '../../kds/header/LaneControl';
import type { PointStation } from '../contracts';

// 03b v1.0.8 §3.4, §3.7 (Q-44, Q-45; P2; frame 03b-C13 in Pass, PassTakeover, PassPortrait): one tile per station of
// the point.
// - dark (under takeover) → `pst dark off`, "Screen offline" (its lanes live in the takeover section, P4);
// - screenless (HK2 `stations[].screenless`) → `pst off`, "No screen" — never shown without the flag (Q-45);
// - lane_count > 1 → "{on} of {count} lanes" ("Custom capacity" when lanes_on is null) with Lane Off / Lane On by the
//   KDS rule (laneTargets, AD-46; K/header/LaneControl, read only): Lane Off hidden at the minimum, Lane On off when
//   all are on; `SetLaneState` on the staff session (`run-pass`); the own result shows at once, a `LanesSet` frame
//   (Q-44) or a catch-up replaces it;
// - else `pst off` with the name only.
// No api (no run-pass) → no lane buttons; offline → buttons off.

const LANES_ICON = ['M8 3v18', 'M16 3v18', 'M12 5v2', 'M12 11v2', 'M12 17v2'];
const NO_SCREEN_ICON = 'M3 3l18 18';

function Tile({ station, api, up }: { station: PointStation; api: Pick<KdsApi, 'setLaneState'> | null; up: boolean }) {
  const [own, setOwn] = useState<SetLaneStateResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const inFlight = useRef(false);
  useEffect(() => setOwn(null), [station.lanes.lanes_on, station.lanes.lane_count]);

  if (station.dark) {
    return (
      <div className="pst dark off">
        <b>{station.name}</b>
        <span className="w c-danger">{t('pass.screen_offline')}</span>
      </div>
    );
  }
  if (station.screenless === true) {
    return (
      <div className="pst off">
        <b>{station.name}</b>
        <span className="w c-mute">
          <svg className="ico" viewBox="0 0 24 24" aria-hidden="true">
            <rect x="3" y="4" width="18" height="12" rx="2" />
            <path d="M8 20h8" />
            <path d="M12 16v4" />
            <path d={NO_SCREEN_ICON} />
          </svg>
          {t('pass.no_screen')}
        </span>
      </div>
    );
  }
  const lanes: Lanes = own ?? station.lanes;
  if (lanes.lane_count <= 1) {
    return (
      <div className="pst off">
        <b>{station.name}</b>
      </div>
    );
  }
  const { off, on } = laneTargets(lanes);
  const send = async (lanes_on: number) => {
    if (api === null || inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    setMsg(null);
    const r = await api.setLaneState({ station_id: station.station_id, lanes_on });
    inFlight.current = false;
    setBusy(false);
    if (r.ok) setOwn(r.data);
    else if (r.error.kind === 'api') setMsg(r.error.code === 'VALIDATION_FAILED' ? t('kds.lanes_failed') : t(errorKey(r.error.code)));
  };
  return (
    <div className="pst">
      <b>{station.name}</b>
      <span className="w c-mute">
        <svg className="ico" viewBox="0 0 24 24" aria-hidden="true">
          {LANES_ICON.map((d) => (
            <path key={d} d={d} />
          ))}
        </svg>
        {lanes.lanes_on === null ? t('kds.lanes_custom') : fill(t('pass.lanes'), { on: String(lanes.lanes_on), count: String(lanes.lane_count) })}
      </span>
      {api !== null && off !== null && (
        <button type="button" className="btn" disabled={!up || busy} onClick={() => void send(off)}>
          <svg className="ico" viewBox="0 0 24 24" aria-hidden="true">
            <path d="M5 12h14" />
          </svg>
          {t('kds.lane_off')}
        </button>
      )}
      {api !== null && (
        <button type="button" className="btn" disabled={!up || busy || on === null} onClick={() => on !== null && void send(on)}>
          <svg className="ico" viewBox="0 0 24 24" aria-hidden="true">
            <path d="M12 5v14" />
            <path d="M5 12h14" />
          </svg>
          {t('kds.lane_on')}
        </button>
      )}
      {msg !== null && (
        <span className="w c-danger" role="status">
          {msg}
        </span>
      )}
    </div>
  );
}

export function StationStrip({
  stations,
  api,
  up,
  wrap = false,
}: {
  stations: readonly PointStation[];
  api: Pick<KdsApi, 'setLaneState'> | null;
  up: boolean;
  /** portrait: the strip wraps (IR-18) */
  wrap?: boolean;
}) {
  return (
    <div className={wrap ? 'pstrip pstrip--wrap' : 'pstrip'}>
      {stations.map((s) => (
        <Tile key={s.station_id} station={s} api={api} up={up} />
      ))}
    </div>
  );
}
