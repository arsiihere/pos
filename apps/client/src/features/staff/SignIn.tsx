import { useCallback, useEffect, useState, useSyncExternalStore, type ReactNode } from 'react';
import type { HubError } from '../../api/hub-admin';
import { t } from '../../i18n';
import { fill } from '../../i18n/en';
import { answerErrorText } from '../alerts/labels';
import { PinKeys, type PinError } from '../alerts/PinStep';
import { CloseX, Dialog, Ico, initial } from '../alerts/ui';
import type { RosterPerson, SignedIn, StaffApi } from './api';
import type { ShellHooks } from './shell/hooks';

// 01d S00 (frames SignIn, SignInPaused, LockKiosk, LockPhone): the admin-stock staff PIN flow (name tiles → PIN;
// AdminLogin), on the device route (00 `GET /queries/staff-roster`, `POST /auth/pin`) and in the Pulse tiles
// (.who). People without a PIN are never on the roster (01b B3). The roster retries while the hub is away.
// The PIN stays in this component until the answer, then it is dropped, also on an error.

export const ROSTER_RETRY_MS = 5_000;

/** 02b §8 Queue (W0.6): without a queue there is nothing to drain and no line. */
const NO_HOOKS: ShellHooks = { beforeSignIn: async () => {}, queueLine: () => null, subscribe: () => () => {} };

function errorOf(error: HubError): PinError {
  if (error.kind === 'network') return { text: t('answer.error.offline'), tone: 'danger', icon: 'wifioff' };
  if (error.kind === 'signed_out') return { text: t('answer.error.failed'), tone: 'danger', icon: 'warn' };
  if (error.code === 'DEVICE_SESSION_ACTIVE') {
    const name = typeof error.details['display_name'] === 'string' ? error.details['display_name'] : '';
    return { text: fill(t('alerts.signin.active'), { name }), tone: 'warn', icon: 'user' };
  }
  if (error.code === 'SERVICE_UNAVAILABLE') return { text: t('answer.error.busy'), tone: 'warn', icon: 'sync' };
  const locked = error.code === 'PIN_LOCKED_OUT' || error.code === 'DEVICE_LOCKED_OUT';
  return { text: answerErrorText(error.code, error.details), tone: 'danger', icon: locked ? 'lock' : 'warn' };
}

export function SignIn({
  api,
  phone,
  lockPanel,
  hooks = NO_HOOKS,
  onSignedIn,
}: {
  api: Pick<StaffApi, 'roster' | 'signIn'>;
  phone: boolean;
  /** F01: lock text above the tiles (kiosk and phone, signed out) */
  lockPanel: ReactNode;
  /** 02b §8 Queue: the queue drains before POST /auth/pin and shows its line here (25c) */
  hooks?: ShellHooks;
  onSignedIn: (who: SignedIn) => void;
}) {
  const queueLine = useSyncExternalStore(hooks.subscribe, hooks.queueLine);
  const [staff, setStaff] = useState<RosterPerson[] | null>(null);
  const [offline, setOffline] = useState(false);
  const [selected, setSelected] = useState<RosterPerson | null>(null);
  const [pin, setPin] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<PinError | null>(null);
  const [takeover, setTakeover] = useState(false);
  const [locked, setLocked] = useState(false);

  const load = useCallback(async () => {
    const answer = await api.roster();
    if (!answer.ok) {
      setOffline(answer.error.kind === 'network');
      if (answer.error.kind !== 'network') setStaff([]);
      return;
    }
    setOffline(false);
    setStaff(answer.data.staff);
  }, [api]);

  useEffect(() => {
    void load();
  }, [load]);
  useEffect(() => {
    if (!offline) return;
    const timer = setInterval(() => void load(), ROSTER_RETRY_MS);
    return () => clearInterval(timer);
  }, [offline, load]);

  // the phone signs in its owner only (00 DEVICE_NOT_OWNED); the roster already holds just them
  const single = phone && staff !== null && staff.length === 1 ? staff[0]! : null;
  const who = selected ?? single;

  const pick = (person: RosterPerson) => {
    setSelected(person);
    setPin('');
    setError(null);
    setTakeover(false);
    setLocked(false);
  };

  const submit = async () => {
    if (who === null || pin.length < 4 || busy) return;
    const typed = pin;
    setPin('');
    setBusy(true);
    setError(null);
    // 02b §3.12: the queue is drained before a new login (a failed drain does not block it)
    await hooks.beforeSignIn().catch(() => {});
    const answer = await api.signIn(who.staff_id, typed, takeover);
    setBusy(false);
    if (answer.ok) {
      onSignedIn(answer.data);
      return;
    }
    const e = errorOf(answer.error);
    setError(e);
    if (answer.error.kind === 'api' && answer.error.code === 'DEVICE_SESSION_ACTIVE') setTakeover(true);
    if (answer.error.kind === 'api' && (answer.error.code === 'PIN_LOCKED_OUT' || answer.error.code === 'DEVICE_LOCKED_OUT')) setLocked(true);
  };

  // closing the PIN dialog drops what was typed (the PIN is never kept)
  const closePin = () => {
    setSelected(null);
    setPin('');
    setError(null);
    setTakeover(false);
    setLocked(false);
  };

  const keys = (
    <PinKeys
      length={pin.length}
      disabled={busy || locked}
      actionLabel={t('alerts.signin.submit')}
      onDigit={(d) => {
        setError((e) => (e?.tone === 'warn' ? e : null));
        setPin((p) => (p.length < 6 ? p + d : p));
      }}
      onBack={() => setPin((p) => p.slice(0, -1))}
      onSubmit={() => void submit()}
      error={error}
      narrow={phone}
    />
  );

  if (offline) {
    return (
      <main className="body body--signin">
        {lockPanel}
        {queueLine !== null && (
          <p className="muted signin__p" role="status">
            {queueLine}
          </p>
        )}
        <div className="msg c-danger" role="alert">
          <Ico name="wifioff" />
          <span>{t('alerts.signin.offline')}</span>
        </div>
        <button type="button" className="btn btn--lg" onClick={() => void load()}>
          <Ico name="sync" />
          {t('alerts.signin.retry')}
        </button>
      </main>
    );
  }

  if (single !== null) {
    return (
      <main className="ph-body">
        {lockPanel}
        {queueLine !== null && (
          <p className="muted signin__p" role="status">
            {queueLine}
          </p>
        )}
        <div className="card col signin__phone">{keys}</div>
      </main>
    );
  }

  return (
    <main className="body body--signin">
      {lockPanel}
      {queueLine !== null && (
        <p className="muted signin__p" role="status">
          {queueLine}
        </p>
      )}
      <div>
        <h1 className="signin__h1">{t('alerts.signin.who')}</h1>
        <p className="muted signin__p">{t('alerts.signin.pick')}</p>
      </div>
      {staff === null ? (
        <div className="who who--big who--tiles" aria-busy="true">
          {[0, 1, 2, 3, 4].map((i) => (
            <span key={i} className="sk sk--tile" />
          ))}
        </div>
      ) : staff.length === 0 ? (
        <p className="ro">{t('alerts.signin.none')}</p>
      ) : (
        <div className="who who--big who--tiles">
          {staff.map((s) => {
            const isLocked = s.locked_until != null;
            return (
              <button
                key={s.staff_id}
                type="button"
                className={`who__t${isLocked ? ' locked' : ''}`}
                aria-pressed={selected?.staff_id === s.staff_id}
                disabled={isLocked}
                onClick={() => pick(s)}
              >
                <span className="av">{initial(s.display_name)}</span>
                <span>
                  <b>{s.display_name}</b>
                  {isLocked && (
                    <small>
                      <Ico name="lock" className="ico--14" /> {t('staff.locked')}
                    </small>
                  )}
                </span>
              </button>
            );
          })}
        </div>
      )}
      {selected !== null && (
        <Dialog sheet={phone} labelledBy="dt" onClose={closePin}>
          <div className="dlg__h">
            <button type="button" className="btn" onClick={closePin}>
              <Ico name="back" />
              {t('answer.back')}
            </button>
            <span className="grow" />
            <CloseX onClose={closePin} />
          </div>
          <div className="pin">
            <h2 className="pin__t" id="dt">
              {fill(t('alerts.signin.pin_for'), { name: selected.display_name })}
            </h2>
            {keys}
            <p className="pin__help">{t('answer.pin_not_kept')}</p>
          </div>
        </Dialog>
      )}
    </main>
  );
}
