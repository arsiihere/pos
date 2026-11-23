import { useCallback, useEffect, useState } from 'react';
import { t } from '../../i18n';
import { fill, type MessageKey } from '../../i18n/en';
import { Ico } from '../alerts/ui';
import { MIN_NATIVE_API, type NativeBridge, type NativeChannel, type NativeHealth, type SettingKey } from './bridge';

// 05b M-18 / C-1: the Me screen's device-health card inside the tablet app, from `PosNative.health()`. A row that
// needs attention is red; on a non-device-owner tablet it has a "Fix" button opening the matching Settings screen
// (`openSetting`). The wake lock can be turned off for a carried tablet (M-5, OQ-3).

interface Row {
  key: string;
  label: MessageKey;
  /** the label with its placeholders filled (a channel's id) */
  labelVars?: Record<string, string>;
  value: string;
  /** true fine, false red, null information only */
  ok: boolean | null;
  fix?: SettingKey;
}

/** M-18 (§3.5 health): the urgent channel must ring (importance >= IMPORTANCE_HIGH 4, a sound); the others must
 * exist and not be silenced below IMPORTANCE_DEFAULT 3. Channel ids are MainHealth.CHANNEL_IDS. */
export const URGENT_CHANNEL = 'pos_urgent_v1';
export function channelOk(id: string, c: NativeChannel): boolean {
  const importance = typeof c.importance === 'number' ? c.importance : -1;
  if (id === URGENT_CHANNEL) return c.exists && importance >= 4 && c.sound !== null && c.sound !== undefined && c.sound !== '';
  return c.exists && importance >= 3;
}

const yesNo = (v: boolean | null | undefined): string => (v === null || v === undefined ? '—' : t(v ? 'native.health.yes' : 'native.health.no'));

/** The rows of the card (pure; exported for the render test). */
export function healthRows(h: NativeHealth): Row[] {
  const socket = h.alert_socket ?? 'down';
  const channelRows: Row[] = Object.entries(h.channels ?? {}).map(([id, c]) => {
    const ok = channelOk(id, c);
    return { key: `channel:${id}`, label: 'native.health.channel', labelVars: { name: id }, value: yesNo(ok), ok, fix: 'notifications' };
  });
  const replaced = h.replaced_by_other;
  const rows: Row[] = [
    { key: 'service', label: 'native.health.service', value: t(h.service_connected ? 'native.health.service_on' : 'native.health.service_off'), ok: h.service_connected },
    { key: 'socket', label: 'native.health.socket', value: t(`native.health.socket_${socket}` as MessageKey), ok: socket === 'up' },
    {
      key: 'last_frame',
      label: 'native.health.last_frame',
      value: h.last_frame_age_ms === null || h.last_frame_age_ms === undefined ? '—' : fill(t('native.health.last_frame_ago'), { s: String(Math.round(h.last_frame_age_ms / 1000)) }),
      ok: null,
    },
    { key: 'notifications', label: 'native.health.notifications', value: yesNo(h.post_notifications), ok: h.post_notifications, fix: 'notifications' },
    ...channelRows,
    // §3.5 close 4409: another connection with this device token took the alert socket over
    {
      key: 'replaced',
      label: 'native.health.replaced',
      value: replaced === null || replaced === undefined ? '—' : t(replaced ? 'native.health.replaced_yes' : 'native.health.no'),
      ok: replaced === null || replaced === undefined ? null : !replaced,
    },
    { key: 'fsi', label: 'native.health.fsi', value: yesNo(h.fsi_allowed), ok: h.fsi_allowed, fix: 'fsi' },
    { key: 'battery', label: 'native.health.battery', value: yesNo(h.battery_exempt), ok: h.battery_exempt, fix: 'battery' },
    // openSetting has no exact-alarm key (Watchdog.kt: USE_EXACT_ALARM is granted at install on API 33+;
    // SCHEDULE_EXACT_ALARM on 31–32 is switched under "Alarms & reminders"), so "Fix" opens the app's own details
    // page (openSetting 'app', ACTION_APPLICATION_DETAILS_SETTINGS), from where the user reaches it
    { key: 'exact', label: 'native.health.exact', value: yesNo(h.exact_alarms), ok: h.exact_alarms, fix: 'app' },
    { key: 'install', label: 'native.health.install', value: yesNo(h.can_install), ok: h.can_install, fix: 'install' },
    { key: 'store', label: 'native.health.store', value: yesNo(h.store_readable), ok: h.store_readable === null || h.store_readable === undefined ? null : h.store_readable },
    { key: 'owner', label: 'native.health.owner', value: yesNo(h.device_owner), ok: null },
    { key: 'lock', label: 'native.health.lock', value: t(`native.health.lock_${h.lock_task_state ?? 'none'}` as MessageKey), ok: null },
    { key: 'wake', label: 'native.health.wake', value: yesNo(h.wake_lock), ok: null },
    { key: 'version', label: 'native.health.version', value: h.version_name ?? '—', ok: null },
    { key: 'api', label: 'native.health.api', value: String(h.native_api ?? '—'), ok: typeof h.native_api === 'number' ? h.native_api >= MIN_NATIVE_API : null },
  ];
  return rows;
}

export function DeviceHealth({ native }: { native: NativeBridge }) {
  const [health, setHealth] = useState<NativeHealth | null | 'loading'>('loading');
  const load = useCallback(async () => {
    setHealth(await native.health());
  }, [native]);
  useEffect(() => {
    void load();
  }, [load]);

  const fix = async (which: SettingKey) => {
    await native.openSetting({ which });
    await load();
  };
  const toggleWake = async (on: boolean) => {
    await native.setWakeLock({ on });
    await load();
  };

  return (
    <section className="card col" aria-labelledby="device-health-title" data-native="health">
      <b id="device-health-title">{t('native.health.title')}</b>
      {health === 'loading' ? null : health === null ? (
        <p className="msg c-danger" role="status">
          <Ico name="warn" />
          {t('native.health.unavailable')}
        </p>
      ) : (
        <>
          {healthRows(health).map((r) => (
            <div key={r.key} className={`row${r.ok === false ? ' c-danger' : ''}`} data-row={r.key} data-ok={r.ok === null ? 'info' : String(r.ok)}>
              {r.ok === false && <Ico name="warn" />}
              <span>{r.labelVars === undefined ? t(r.label) : fill(t(r.label), r.labelVars)}</span>
              <b className="num">{r.value}</b>
              {r.ok === false && r.fix !== undefined && !health.device_owner && (
                <button type="button" className="btn" onClick={() => void fix(r.fix!)}>
                  {t('native.health.fix')}
                </button>
              )}
              {r.key === 'wake' && health.wake_lock !== null && (
                <button type="button" className="btn" onClick={() => void toggleWake(!health.wake_lock)}>
                  {t(health.wake_lock ? 'native.health.wake_turn_off' : 'native.health.wake_turn_on')}
                </button>
              )}
            </div>
          ))}
        </>
      )}
      <button type="button" className="btn btn--lg" onClick={() => void load()}>
        <Ico name="sync" />
        {t('native.health.refresh')}
      </button>
    </section>
  );
}
