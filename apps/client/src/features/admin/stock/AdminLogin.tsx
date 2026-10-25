import { useEffect, useState } from 'react';
import type { HubAdmin, HubError } from '../../../api/hub-admin';
import { Banner } from '../../../components/Banner';
import { PinPad } from '../../../components/PinPad';
import { StaffTiles, type StaffTile } from '../../../components/StaffTiles';
import { t } from '../../../i18n';
import { adminErrorKey } from '../../../i18n/en';

// §8.2, S35 i: the admin roster and PIN pad (same endpoints as 00 §8.2), from the shared StaffTiles
// and PinPad.
function errorText(error: HubError): string {
  if (error.kind === 'network') return t('admin_stock.errors.network');
  if (error.kind === 'signed_out') return t('errors.ADMIN_SESSION_REQUIRED');
  return t(adminErrorKey(error.code));
}

export function AdminLogin({ api, onLoggedIn }: { api: HubAdmin; onLoggedIn: () => void }) {
  const [staff, setStaff] = useState<StaffTile[] | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<HubError | null>(null);

  useEffect(() => {
    let live = true;
    void api.roster().then((answer) => {
      if (!live) return;
      if (!answer.ok) {
        setError(answer.error);
        setStaff([]);
        return;
      }
      const now = Date.now();
      setStaff(
        answer.data.staff.map((s) => ({
          staff_id: s.staff_id,
          display_name: s.display_name,
          locked: s.locked_until !== null && s.locked_until > now,
        })),
      );
    });
    return () => {
      live = false;
    };
  }, [api]);

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

  return (
    <main className="pos-screen">
      <section className="pos-card pos-stack">
        <h1 className="title">{t('admin_stock.login.title')}</h1>
        {staff === null ? (
          <p aria-busy="true">{t('admin_stock.login.loading')}</p>
        ) : staff.length === 0 && error === null ? (
          <Banner tone="info" text={t('admin_stock.login.no_admins')} />
        ) : (
          <>
            <p>{t('admin_stock.login.pick')}</p>
            <StaffTiles staff={staff} selectedId={selected} onPick={setSelected} />
            {selected !== null && <PinPad onSubmit={(pin) => void submit(pin)} disabled={busy} error={pinRefused} />}
          </>
        )}
        {error !== null && <Banner tone="danger" text={errorText(error)} />}
      </section>
    </main>
  );
}
