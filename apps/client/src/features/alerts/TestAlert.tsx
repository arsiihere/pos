import { useState } from 'react';
import type { DeviceType } from '@pos/domain';
import type { SendTestAlertPayload } from '@pos/events';
import { t } from '../../i18n';
import { fill } from '../../i18n/en';
import { Ico, initial, type IconName } from './ui';

// 01d §6.5 S03 (frames TestAlert, TestAlertPerson, TestAlertTeam; needs manage-devices): Person · Team · Device ·
// Point (off until points exist), a radio list, and a summary card with Send test (the layer's one primary).
// The lists come from what a staff device may read: the device roster (people with a PIN) and this device
// (the hub has no device-route staff or device list; proposed AD, unattended).

export type TestTarget = SendTestAlertPayload['target'];
export type SendResult = { ok: true; alert_id: string } | { ok: false; code: string };

interface Person {
  staff_id: string;
  display_name: string;
}

type Mode = 'person' | 'team' | 'device';

const MODE_ICON: Record<Mode | 'point', IconName> = { person: 'user', team: 'team', device: 'tablet', point: 'pin' };

function errorText(code: string): string {
  if (code === 'STAFF_NOT_FOUND' || code === 'DEVICE_NOT_FOUND') return t('test.not_found');
  if (code === 'PERMISSION_DENIED') return t('test.denied');
  if (code === 'NETWORK') return t('answer.error.offline');
  return t('answer.error.failed');
}

export function TestAlert({
  people,
  device,
  send,
  onSent,
}: {
  people: readonly Person[];
  device: { device_id: string; device_type: DeviceType } | null;
  send: (target: TestTarget) => Promise<SendResult>;
  /** the new alert and the "to …" words for the receipts header */
  onSent: (alertId: string, to: string) => void;
}) {
  const [mode, setMode] = useState<Mode>('device');
  const [picked, setPicked] = useState<string | null>(device?.device_id ?? null);
  const [depth, setDepth] = useState<'direct' | 'all'>('direct');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const switchTo = (next: Mode) => {
    setMode(next);
    setError(null);
    setPicked(next === 'device' ? (device?.device_id ?? null) : null);
  };

  const person = people.find((p) => p.staff_id === picked);
  const deviceWord = device === null ? '' : t(`alerts.device.${device.device_type}`);
  const summary: { icon: IconName; name: string; sub: string } | null =
    mode === 'device'
      ? device !== null && picked === device.device_id
        ? { icon: 'tablet', name: t('test.this_device'), sub: deviceWord }
        : null
      : person === undefined
        ? null
        : mode === 'person'
          ? { icon: 'user', name: person.display_name, sub: t('test.person_sub') }
          : { icon: 'team', name: fill(t('test.team_of'), { name: person.display_name }), sub: t(depth === 'direct' ? 'test.direct' : 'test.whole') };

  const target = (): TestTarget | null => {
    if (picked === null) return null;
    if (mode === 'device') return { kind: 'device', device_id: picked };
    if (mode === 'person') return { kind: 'person', staff_id: picked };
    return { kind: 'team', lead_staff_id: picked, depth };
  };

  const submit = async () => {
    const to = target();
    if (to === null || summary === null) return;
    setBusy(true);
    setError(null);
    const result = await send(to);
    setBusy(false);
    if (result.ok) onSent(result.alert_id, summary.name);
    else setError(errorText(result.code));
  };

  const radio = (id: string, icon: 'av' | IconName, name: string, sub: string | null) => (
    <button key={id} type="button" className="pick__r" role="radio" aria-checked={picked === id} onClick={() => setPicked(id)}>
      <span className="radio" />
      {icon === 'av' ? (
        <span className="av">{initial(name)}</span>
      ) : (
        <span className="ar__ic ar__ic--44 c-mute">
          <Ico name={icon} />
        </span>
      )}
      <span>
        <b>{name}</b>
        {sub !== null && sub !== '' && <small>{sub}</small>}
      </span>
    </button>
  );

  return (
    <main className="body body--test">
      <section className="lcard">
        <div className="lcard__h">
          <h2>{t('test.title')}</h2>
          <div className="end" />
        </div>
        <div className="lcard__b">
          <div className="seg seg--fill" role="group" aria-label={t('test.send_to')}>
            {(['person', 'team', 'device'] as const).map((m) => (
              <button key={m} type="button" aria-pressed={mode === m} onClick={() => switchTo(m)}>
                <Ico name={MODE_ICON[m]} />
                {t(`test.${m}`)}
              </button>
            ))}
            <button type="button" aria-pressed={false} disabled>
              <Ico name={MODE_ICON.point} />
              {t('test.point')}
            </button>
          </div>
          <p className="muted muted--14 pad-x-4">{t('test.point_off')}</p>
          <div className="pick" role="radiogroup" aria-label={t('test.send_to')}>
            {mode === 'team' && (
              <div className="seg seg--fill" role="group">
                <button type="button" aria-pressed={depth === 'direct'} onClick={() => setDepth('direct')}>
                  {t('test.direct')}
                </button>
                <button type="button" aria-pressed={depth === 'all'} onClick={() => setDepth('all')}>
                  {t('test.whole')}
                </button>
              </div>
            )}
            {mode === 'device'
              ? device !== null && radio(device.device_id, 'tablet', t('test.this_device'), deviceWord)
              : people.map((p) => radio(p.staff_id, 'av', p.display_name, null))}
          </div>
        </div>
      </section>
      <aside className="lcard ta">
        <span className="muted ta__lead">{t('test.summary')}</span>
        {summary !== null && (
          <div className="row ta__who">
            <span className="ar__ic ar__ic--64 c-brand">
              <Ico name={summary.icon} className="ico--30" />
            </span>
            <div>
              <b className="ta__name">{summary.name}</b>
              <p className="muted ta__sub">{summary.sub}</p>
            </div>
          </div>
        )}
        <span className="grow" />
        {error !== null && (
          <div className="msg c-danger" role="alert">
            <Ico name="warn" />
            <span>{error}</span>
          </div>
        )}
        <button type="button" className="btn btn--primary btn--lg btn--block" disabled={summary === null || busy} onClick={() => void submit()}>
          <Ico name="send" />
          {t('test.send')}
        </button>
        <p className="muted muted--14 ta__after">{t('test.after')}</p>
      </aside>
    </main>
  );
}
