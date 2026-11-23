import { useState } from 'react';
import { Banner } from '../../../components/Banner';
import { BusyButton } from '../../../components/BusyButton';
import { Dialog } from '../../../components/Dialog';
import { Skeleton } from '../../../components/Skeleton';
import { t } from '../../../i18n';
import { fill } from '../../../i18n/en';
import type { HubDevice, KdsScreen } from './api';

// 03b §3.8, §6.10; 03b-D03 (frames KitchenScreensBind, KitchenScreensLane).

export const LANE_LABEL_MAX = 20;

/**
 * 05a K-2 (§8, §4.5; task 33): Pass is set on the device itself (`point_id` is the device's profile, K-1), so this dialog
 * no longer picks a point and sends nothing. It lists every unrevoked non-kds device (00's `devices` query), each with a
 * link to its edit form (`#/devices` in /staff/, §8); the device asked for with `#bind=` comes first.
 */
export function BindDialog({
  devices,
  initialDeviceId,
  error,
  onClose,
}: {
  devices: readonly HubDevice[] | null;
  initialDeviceId: string | null;
  error: string | null;
  onClose: () => void;
}) {
  const shown = devices?.filter((d) => d.device_type !== 'kds' && d.revoked_at === null) ?? null;
  const ordered = shown === null ? null : [...shown].sort((a, b) => Number(b.device_id === initialDeviceId) - Number(a.device_id === initialDeviceId));
  return (
    <Dialog
      title={t('kitchen_screens.bind')}
      onClose={onClose}
      footer={
        <button type="button" className="pos-btn" onClick={onClose}>
          {t('common.cancel')}
        </button>
      }
    >
      <p className="pos-dialog__body">{t('kitchen_screens.bind_help')}</p>
      {error !== null && <Banner tone="danger" text={error} />}
      {ordered === null ? (
        <Skeleton lines={2} />
      ) : (
        <ul className="pos-list" data-section="bind-devices">
          {ordered.map((d) => (
            <li key={d.device_id} className="pos-list__row" data-device={d.device_id}>
              <b>{d.device_name}</b>
              <a className="pos-link" href={`/staff/#/devices?edit=${encodeURIComponent(d.device_id)}`}>
                {t('devices.edit')}
              </a>
            </li>
          ))}
        </ul>
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
