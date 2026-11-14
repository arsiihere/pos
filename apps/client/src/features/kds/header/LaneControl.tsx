import { useEffect, useRef, useState } from 'react';
import { t } from '../../../i18n';
import { errorKey } from '../../../i18n/en';
import type { KdsApi, SetLaneStateResult } from '../contracts';

// 03b v1.0.8 §3.7, AD-46, Q-44 (K4; frames 03b-C08 KdsLaneStates, KdsLaneOff, KdsLaneCustom; handoff Q-3).
// - "Lanes: {on} of {count} on"; Lane Off sends lanes_on − 1, Lane On sends lane_count (all on).
// - Lane Off is hidden at lane_count 1 or when only 1 lane is on; Lane On is off when all lanes are on.
// - Custom capacity (lanes_on null): "Custom capacity"; Lane Off sends lane_count − 1, Lane On lane_count.
// - No confirm (no modals on the KDS). The new numbers show at once from the command's result; the `LanesSet` frame
//   (Q-44) keeps every lane screen current — before hub task HK1 the own result is the only update (the row's fallback).

export type Lanes = { lanes_on: number | null; lane_count: number };

export function laneTargets(l: Lanes): { off: number | null; on: number | null } {
  const off = l.lane_count <= 1 ? null : l.lanes_on === null ? l.lane_count - 1 : l.lanes_on <= 1 ? null : l.lanes_on - 1;
  const on = l.lanes_on === l.lane_count ? null : l.lane_count;
  return { off, on };
}

export function LaneControl({ lanes, stationId, api, up }: { lanes: Lanes; stationId: string; api: KdsApi; up: boolean }) {
  const [own, setOwn] = useState<SetLaneStateResult | null>(null);
  const [busy, setBusy] = useState(false);
  /** one SetLaneState at a time (a ref, independent of renders); an absolute lanes_on, so a repeat is harmless anyway */
  const inFlight = useRef(false);
  const [msg, setMsg] = useState<string | null>(null);
  // a frame (LanesSet, catch-up) replaces the own result
  useEffect(() => setOwn(null), [lanes.lanes_on, lanes.lane_count]);
  const shown: Lanes = own ?? lanes;
  const { off, on } = laneTargets(shown);

  const send = async (lanes_on: number) => {
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    setMsg(null);
    const r = await api.setLaneState({ station_id: stationId, lanes_on });
    inFlight.current = false;
    setBusy(false);
    if (r.ok) setOwn(r.data);
    else if (r.error.kind === 'api') setMsg(r.error.code === 'VALIDATION_FAILED' ? t('kds.lanes_failed') : t(errorKey(r.error.code)));
  };

  return (
    <div className="kbar__lanes">
      <span className="st">
        <svg className="ico" viewBox="0 0 24 24" aria-hidden="true">
          <path d="M8 3v18" />
          <path d="M16 3v18" />
          <path d="M12 5v2" />
          <path d="M12 11v2" />
          <path d="M12 17v2" />
        </svg>
        {shown.lanes_on === null ? (
          t('kds.lanes_custom')
        ) : (
          <>
            {t('kds.lanes').split('{on}')[0]}
            <b className="num">{shown.lanes_on}</b>
            {t('kds.lanes').split('{on}')[1]!.split('{count}')[0]}
            <b className="num">{shown.lane_count}</b>
            {t('kds.lanes').split('{count}')[1]}
          </>
        )}
      </span>
      {off !== null && (
        <button type="button" className="btn" disabled={!up || busy} onClick={() => void send(off)}>
          <svg className="ico" viewBox="0 0 24 24" aria-hidden="true">
            <path d="M5 12h14" />
          </svg>
          {t('kds.lane_off')}
        </button>
      )}
      <button type="button" className="btn" disabled={!up || busy || on === null} onClick={() => on !== null && void send(on)}>
        <svg className="ico" viewBox="0 0 24 24" aria-hidden="true">
          <path d="M12 5v14" />
          <path d="M5 12h14" />
        </svg>
        {t('kds.lane_on')}
      </button>
      {msg !== null && (
        <span className="kbar__dev" role="status">
          {msg}
        </span>
      )}
    </div>
  );
}
