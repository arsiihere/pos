import type { ReactNode } from 'react';
import { Chip, type ChipTone } from '../../../components/Chip';
import { Icon } from '../../../components/Icon';
import { t } from '../../../i18n';
import { fill } from '../../../i18n/en';
import type { AudioSink } from '../../alerts/sounds';
import type { KdsPoint, KdsScreen, KdsStation, PassTablet, ScreenState } from './api';
import { VolumeControl } from './VolumeControl';

// 03b §3.8, §6.12; 03b-C14 station card and the Pass tablets section (frames KitchenScreens, KitchenScreensWarn).

// The frame glyphs the shared Icon set does not have (paths copied from the frames).
const GLYPHS = {
  tablet: (
    <>
      <rect x="5" y="3" width="14" height="18" rx="2" />
      <path d="M11 18h2" />
    </>
  ),
  'no-screen': (
    <>
      <rect x="3" y="4" width="18" height="12" rx="2" />
      <path d="M8 20h8" />
      <path d="M12 16v4" />
      <path d="M3 3l18 18" />
    </>
  ),
  lanes: (
    <>
      <path d="M8 3v18" />
      <path d="M16 3v18" />
      <path d="M12 5v2" />
      <path d="M12 11v2" />
      <path d="M12 17v2" />
    </>
  ),
  volume: (
    <>
      <path d="M4 9.5h4l5-4v13l-5-4H4z" />
      <path d="M16.5 9a4 4 0 0 1 0 6" />
      <path d="M19 6.5a7.5 7.5 0 0 1 0 11" />
    </>
  ),
  play: <path d="M7 4.5v15l12-7.5z" />,
  printer: (
    <>
      <path d="M7 9V3.5h10V9" />
      <rect x="3.5" y="9" width="17" height="8" rx="2" />
      <path d="M7 14.5h10V21H7z" />
    </>
  ),
} satisfies Record<string, ReactNode>;

export type GlyphName = keyof typeof GLYPHS;

export function Glyph({ name }: { name: GlyphName }) {
  return (
    <svg className="pos-icon" viewBox="0 0 24 24" aria-hidden="true">
      {GLYPHS[name]}
    </svg>
  );
}

const STATE: Record<ScreenState, { tone: ChipTone; icon: 'check' | 'user' | 'alert'; key: 'kitchen_screens.state.connected' | 'kitchen_screens.state.signed_out' | 'kitchen_screens.state.offline' }> = {
  connected: { tone: 'ok', icon: 'check', key: 'kitchen_screens.state.connected' },
  signed_out: { tone: 'warn', icon: 'user', key: 'kitchen_screens.state.signed_out' },
  offline: { tone: 'danger', icon: 'alert', key: 'kitchen_screens.state.offline' },
};

export function StateChip({ state }: { state: ScreenState }) {
  const s = STATE[state];
  return (
    <Chip tone={s.tone} icon={s.icon}>
      {t(s.key)}
    </Chip>
  );
}

/** Q-48: the point's name from kds-config `points` (HK6); before HK6 (or for an unknown id) the id itself. */
export function pointName(points: readonly KdsPoint[] | undefined, pointId: string): string {
  return points?.find((p) => p.point_id === pointId)?.name ?? pointId;
}

// "Lane: Left" with the label in bold, as the frame.
function LaneLine({ label }: { label: string | null }) {
  if (label === null) return <small>{t('kitchen_screens.no_lane_label')}</small>;
  const [before, after] = t('kitchen_screens.lane').split('{label}');
  return (
    <small>
      {before}
      <strong>{label}</strong>
      {after}
    </small>
  );
}

// §6.12 lanes: lanes_on null = custom capacity (AD-46); a one-lane station shows no lanes chip (frame Karahi).
function LanesChip({ lanes }: { lanes: KdsStation['lanes'] }) {
  if (lanes.lanes_on === null) {
    return (
      <span className="pos-chip">
        <Glyph name="lanes" />
        {t('kitchen_screens.lanes_custom')}
      </span>
    );
  }
  if (lanes.lane_count <= 1) return null;
  return (
    <span className="pos-chip">
      <Glyph name="lanes" />
      {fill(t('kitchen_screens.lanes'), { on: String(lanes.lanes_on), count: String(lanes.lane_count) })}
    </span>
  );
}

function ScreenRow({ screen, busy, onLaneLabel }: { screen: KdsScreen; busy: boolean; onLaneLabel: () => void }) {
  return (
    <div className="scr">
      <Icon name="screen" />
      <div>
        <b>{screen.name}</b>
        <LaneLine label={screen.lane_label} />
      </div>
      <StateChip state={screen.state} />
      <button type="button" className="pos-btn" disabled={busy} onClick={onLaneLabel}>
        <Icon name="edit" />
        {t('kitchen_screens.lane_label')}
      </button>
    </div>
  );
}

export function StationRow({
  station,
  points,
  busy,
  sink,
  onVolume,
  onLaneLabel,
}: {
  station: KdsStation;
  points: readonly KdsPoint[] | undefined;
  busy: boolean;
  sink: AudioSink;
  onVolume: (volume: number) => void;
  onLaneLabel: (screen: KdsScreen) => void;
}) {
  return (
    <article className={`pos-card ks${station.dark ? ' ks--dark' : ''}`}>
      <div className="ks__h">
        <strong>{station.name}</strong>
        <div className="pos-chips">
          <span className="pos-chip">{fill(t('kitchen_screens.point'), { point: pointName(points, station.point_id) })}</span>
          <LanesChip lanes={station.lanes} />
          {station.dark && <Chip tone="danger">{t('kitchen_screens.dark')}</Chip>}
        </div>
      </div>
      {station.screens.length === 0 ? (
        // 03b D11: a station with no screen; its lines show on the Pass, so it has no chime to set.
        <div className="scr scr--none">
          <Glyph name="no-screen" />
          <div>
            <b>{t('kitchen_screens.no_screen')}</b>
          </div>
        </div>
      ) : (
        <>
          {station.screens.map((screen) => (
            <ScreenRow key={screen.device_id} screen={screen} busy={busy} onLaneLabel={() => onLaneLabel(screen)} />
          ))}
          <VolumeControl stationName={station.name} volume={station.sound_volume} disabled={busy} sink={sink} onSave={onVolume} />
        </>
      )}
    </article>
  );
}

export function PassTablets({
  tablets,
  points,
  busy,
  onChange,
  onBind,
}: {
  tablets: readonly PassTablet[];
  points: readonly KdsPoint[] | undefined;
  busy: boolean;
  onChange: (tablet: PassTablet) => void;
  onBind: () => void;
}) {
  return (
    <section className="ad-stack" data-section="pass-tablets">
      <div className="ad-sec__h">
        <div>
          <h2>{t('kitchen_screens.pass_tablets')}</h2>
          <p>{t('kitchen_screens.pass_tablets_help')}</p>
        </div>
      </div>
      <article className="pos-card ks">
        {tablets.map((tablet) => {
          // Q-48: a tablet bound to an archived point (HK6 points[]) is told to move.
          const archived = points?.find((p) => p.point_id === tablet.point_id)?.is_archived === true;
          return (
            <div className="scr" key={tablet.device_id}>
              <Glyph name="tablet" />
              <div>
                <b>{tablet.name}</b>
                <small>{t('kitchen_screens.tablet_sub')}</small>
              </div>
              <span className="pos-row">
                {archived ? (
                  <Chip tone="warn" icon="alert">
                    {t('kitchen_screens.point_archived')}
                  </Chip>
                ) : (
                  <span className="pos-chip">{fill(t('kitchen_screens.point'), { point: pointName(points, tablet.point_id) })}</span>
                )}
                <StateChip state={tablet.state} />
              </span>
              <button type="button" className="pos-btn" disabled={busy} onClick={() => onChange(tablet)}>
                <Icon name="edit" />
                {t('kitchen_screens.change')}
              </button>
            </div>
          );
        })}
        <div className="pos-row">
          <button type="button" className="pos-btn" disabled={busy} onClick={onBind}>
            <Icon name="plus" />
            {t('kitchen_screens.use_tablet')}
          </button>
          <span className="pos-field__help">{t('admin.ks.signed_out_normal')}</span>
        </div>
      </article>
    </section>
  );
}
