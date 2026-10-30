import { useCallback, useEffect, useState } from 'react';
import type { HubAdmin, HubError } from '../../../api/hub-admin';
import { usePhone } from '../../../app/phone';
import { AppBar } from '../../../components/AppBar';
import { Banner } from '../../../components/Banner';
import { Chip } from '../../../components/Chip';
import { Icon } from '../../../components/Icon';
import { PinPad } from '../../../components/PinPad';
import { Skeleton } from '../../../components/Skeleton';
import { StaffTiles, type StaffTile } from '../../../components/StaffTiles';
import { t } from '../../../i18n';
import { adminErrorKey, fill } from '../../../i18n/en';

// §8.2, S35 i, S54 d (01a-S10): the admin roster and PIN pad (same endpoints as 00 §8.2), from the shared
// StaffTiles and PinPad. The roster is shown as the hub sends it; an empty one means nobody can open the
// page. A wrong PIN says how many tries are left once 2 or fewer; a lock says for how many minutes (from
// retry_after_ms, rounded up). While the hub cannot be reached the page retries, with Retry now.
export const ROSTER_RETRY_MS = 5_000;

function minutes(ms: unknown): string {
  return String(Math.max(1, Math.ceil((typeof ms === 'number' ? ms : 0) / 60_000)));
}

function errorBanner(error: HubError): { text: string; detail?: string } {
  if (error.kind === 'network') return { text: t('admin_stock.errors.network') };
  if (error.kind === 'signed_out') return { text: t('errors.ADMIN_SESSION_REQUIRED') };
  if (error.code === 'PIN_INVALID') {
    const left = error.details['attempts_remaining'];
    return typeof left === 'number' && left <= 2
      ? { text: t('errors.PIN_INVALID'), detail: fill(t('admin_stock.login.tries_left'), { n: String(left) }) }
      : { text: t('errors.PIN_INVALID') };
  }
  if (error.code === 'PIN_LOCKED_OUT' || error.code === 'DEVICE_LOCKED_OUT') {
    return { text: t(adminErrorKey(error.code)), detail: fill(t('admin_stock.login.locked_for'), { n: minutes(error.details['retry_after_ms']) }) };
  }
  return { text: t(adminErrorKey(error.code)) };
}

export function AdminLogin({ api, onLoggedIn }: { api: HubAdmin; onLoggedIn: () => void }) {
  const phone = usePhone();
  const [staff, setStaff] = useState<StaffTile[] | null>(null);
  const [offline, setOffline] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<HubError | null>(null);

  const load = useCallback(async () => {
    const answer = await api.roster();
    if (!answer.ok) {
      if (answer.error.kind === 'network') {
        setOffline(true);
        return;
      }
      setOffline(false);
      setError(answer.error);
      setStaff([]);
      return;
    }
    setOffline(false);
    // The hub sends null for an expired lock; the device clock is not compared with hub time.
    setStaff(
      answer.data.staff.map((s) => ({
        staff_id: s.staff_id,
        display_name: s.display_name,
        locked_until: s.locked_until,
        sub: (s.role_names ?? []).join(', '),
      })),
    );
  }, [api]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (!offline) return;
    const timer = setInterval(() => void load(), ROSTER_RETRY_MS);
    return () => clearInterval(timer);
  }, [offline, load]);

  const submit = async (pin: string) => {
    if (selected === null) return;
    setBusy(true);
    setError(null);
    const answer = await api.login(selected, pin);
    setBusy(false);
    if (answer.ok) onLoggedIn();
    else setError(answer.error);
  };

  const pinRefused = error?.kind === 'api' && error.code === 'PIN_INVALID';
  // 01a-S10: "Forgot your PIN?" shows only after a wrong PIN or a lock (brief §6 Q-list, StockPinError).
  const forgot = error?.kind === 'api' && (error.code === 'PIN_INVALID' || error.code === 'PIN_LOCKED_OUT');
  const banner = error === null ? null : errorBanner(error);
  const name = staff?.find((s) => s.staff_id === selected)?.display_name;
  const [pinBefore, pinAfter] = t('admin_stock.login.pin_for').split('{name}');

  return (
    <div className={`pos-page${phone ? '' : ' pos-page--fit'}`}>
      <AppBar
        title={t('admin_stock.title')}
        phone={phone}
        after={<Chip icon="lock">{t('admin_stock.login.title')}</Chip>}
      />
      {offline ? (
        <main className="pos-screen pos-screen--warn">
          <div className="pos-screen__icon pos-screen__icon--spin">
            <Icon name="sync" />
          </div>
          <h2 className="pos-screen__title">{t('admin_stock.login.offline')}</h2>
          <p className="pos-screen__body">{t('admin_stock.login.offline_body')}</p>
          <div className="pos-row pos-signin__retry">
            <button type="button" className="pos-btn pos-btn--primary pos-btn--lg" onClick={() => void load()}>
              <Icon name="reload" />
              {t('admin_stock.login.retry_now')}
            </button>
          </div>
        </main>
      ) : staff === null ? (
        <main className="pos-content">
          <Skeleton lines={3} />
        </main>
      ) : staff.length === 0 && error === null ? (
        <main className="pos-screen pos-screen--info">
          <div className="pos-screen__icon">
            <Icon name="user" />
          </div>
          <h2 className="pos-screen__title">{t('admin_stock.login.no_admins')}</h2>
          <p className="pos-screen__body">{t('admin_stock.login.no_admins_body')}</p>
        </main>
      ) : (
        <main className="pos-content pos-signin">
          <section className="pos-signin__who">
            <div className="pos-section__head">
              <h2>{t('admin_stock.login.who')}</h2>
              <p>{t('admin_stock.login.pick')}</p>
            </div>
            <StaffTiles staff={staff} selectedId={selected} onPick={setSelected} />
            {forgot && <Banner tone="info" icon="user" text={t('admin_stock.login.forgot')} />}
            {banner !== null && selected === null && <Banner tone="danger" text={banner.text} detail={banner.detail} />}
          </section>
          {selected !== null && (
            <section className="pos-card pos-signin__pad">
              <div className="pos-signin__for">
                <p>{pinBefore}</p>
                <strong>{name ?? ''}</strong>
                {pinAfter !== undefined && pinAfter !== '' && <p>{pinAfter}</p>}
              </div>
              {banner !== null && <Banner tone="danger" text={banner.text} detail={banner.detail} />}
              <PinPad onSubmit={(pin) => void submit(pin)} disabled={busy} error={pinRefused} />
            </section>
          )}
        </main>
      )}
    </div>
  );
}
