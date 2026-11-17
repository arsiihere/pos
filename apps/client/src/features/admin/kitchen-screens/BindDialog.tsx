import { useState } from 'react';
import { Banner } from '../../../components/Banner';
import { BusyButton } from '../../../components/BusyButton';
import { Dialog } from '../../../components/Dialog';
import { Skeleton } from '../../../components/Skeleton';
import { t } from '../../../i18n';
import { fill } from '../../../i18n/en';
import type { HubDevice, KdsPoint, KdsScreen, KdsStation } from './api';

// 03b §3.8, §6.10; 03b-D03 (frames KitchenScreensBind, KitchenScreensLane).

export const LANE_LABEL_MAX = 20;

/**
 * Bind a tablet to a point (handoff Q-16): the tablet picker is fed by 00's `devices` query (unrevoked tablets
 * only); the point tiles come from kds-config `points` (Q-48, archived ones shown marked and not pickable), each
 * with the names of its stations. Save → SetDeviceRole { device_id, point_id }; "Stop using as Pass tablet" →
 * point_id null (shown for a tablet that has a point).
 */
export function BindDialog({
  tablets,
  points,
  stations,
  initialDeviceId,
  pointOf,
  busy,
  error,
  onSave,
  onUnbind,
  onClose,
}: {
  tablets: readonly HubDevice[] | null;
  points: readonly KdsPoint[];
  stations: readonly KdsStation[];
  initialDeviceId: string | null;
  pointOf: (deviceId: string) => string | null;
  busy: boolean;
  error: string | null;
  onSave: (deviceId: string, pointId: string) => void;
  onUnbind: (deviceId: string) => void;
  onClose: () => void;
}) {
  const [deviceId, setDeviceId] = useState<string | null>(initialDeviceId);
  const [pointId, setPointId] = useState<string | null>(initialDeviceId === null ? null : pointOf(initialDeviceId));
  const shown = tablets?.filter((d) => d.device_type === 'tablet' && d.revoked_at === null) ?? null;
  const device = shown?.find((d) => d.device_id === deviceId) ?? null;
  const bound = deviceId === null ? null : pointOf(deviceId);

  const pick = (id: string) => {
    setDeviceId(id === '' ? null : id);
    setPointId(id === '' ? null : pointOf(id));
  };

  return (
    <Dialog
      title={t('kitchen_screens.bind')}
      onClose={onClose}
      footer={
        <>
          {bound !== null && deviceId !== null && (
            <button type="button" className="pos-btn pos-btn--ghost" disabled={busy} onClick={() => onUnbind(deviceId)}>
              {t('kitchen_screens.unbind')}
            </button>
          )}
          <button type="button" className="pos-btn" onClick={onClose}>
            {t('common.cancel')}
          </button>
          <BusyButton
            primary
            busy={busy}
            disabled={deviceId === null || pointId === null || pointId === bound}
            onClick={() => {
              if (deviceId !== null && pointId !== null) onSave(deviceId, pointId);
            }}
          >
            {t('kitchen_screens.save')}
          </BusyButton>
        </>
      }
    >
      {device !== null && <p className="pos-dialog__body">{fill(t('kitchen_screens.bind_body'), { name: device.device_name })}</p>}
      {error !== null && <Banner tone="danger" text={error} />}
      {shown === null ? (
        <Skeleton lines={2} />
      ) : (
        <>
          <label className="pos-field">
            <span className="pos-field__label">{t('kitchen_screens.tablet')}</span>
            <select className="pos-select" value={deviceId ?? ''} onChange={(e) => pick(e.target.value)}>
              {device === null && <option value="">{t('kitchen_screens.pick_tablet')}</option>}
              {shown.map((d) => (
                <option key={d.device_id} value={d.device_id}>
                  {d.device_name}
                </option>
              ))}
            </select>
          </label>
          <div className="pos-tiles pos-tiles--pick">
            {points.map((p) => (
              <button
                key={p.point_id}
                type="button"
                className="pos-tile"
                aria-pressed={p.point_id === pointId}
                disabled={p.is_archived || busy}
                onClick={() => setPointId(p.point_id)}
              >
                {p.name}
                <small>
                  {p.is_archived
                    ? t('kitchen_screens.point_archived_short')
                    : stations
                        .filter((s) => s.point_id === p.point_id)
                        .map((s) => s.name)
                        .join(', ')}
                </small>
              </button>
            ))}
          </div>
        </>
      )}
    </Dialog>
  );
}

/**
 * A kitchen screen's lane label (H-6, AD-12): 1–20 letters; empty or "Remove label" = not a lane (null). Only
 * screen rows (kds devices with a station) open it, so a Pass tablet never gets one.
 */
export function LaneLabelDialog({
  screen,
  busy,
  error,
  onSave,
  onClose,
}: {
  screen: KdsScreen;
  busy: boolean;
  error: string | null;
  onSave: (label: string | null) => void;
  onClose: () => void;
}) {
  const [label, setLabel] = useState(screen.lane_label ?? '');
  const trimmed = label.trim();
  return (
    <Dialog
      title={fill(t('kitchen_screens.lane_label_for'), { screen: screen.name })}
      onClose={onClose}
      footer={
        <>
          {screen.lane_label !== null && (
            <button type="button" className="pos-btn pos-btn--ghost" disabled={busy} onClick={() => onSave(null)}>
              {t('kitchen_screens.remove_label')}
            </button>
          )}
          <button type="button" className="pos-btn" onClick={onClose}>
            {t('common.cancel')}
          </button>
          <BusyButton
            primary
            busy={busy}
            disabled={trimmed === (screen.lane_label ?? '')}
            onClick={() => onSave(trimmed === '' ? null : trimmed)}
          >
            {t('kitchen_screens.save')}
          </BusyButton>
        </>
      }
    >
      <p className="pos-dialog__body">{t('kitchen_screens.lane_label_help')}</p>
      {error !== null && <Banner tone="danger" text={error} />}
      <label className="pos-field">
        <span className="pos-field__label">{t('kitchen_screens.lane_label')}</span>
        <input className="pos-input" value={label} maxLength={LANE_LABEL_MAX} onChange={(e) => setLabel(e.target.value)} />
        <span className="pos-field__help">{t('kitchen_screens.lane_label_limits')}</span>
      </label>
    </Dialog>
  );
}
