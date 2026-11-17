import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { usePhone } from '../../../app/phone';
import { newUlid } from '../../../app/ulid';
import { AppBar } from '../../../components/AppBar';
import { Banner } from '../../../components/Banner';
import { Chip } from '../../../components/Chip';
import { Icon } from '../../../components/Icon';
import { PinPad } from '../../../components/PinPad';
import { SideNav } from '../../../components/SideNav';
import { Skeleton } from '../../../components/Skeleton';
import { StaffTiles, type StaffTile } from '../../../components/StaffTiles';
import { t, type MessageKey } from '../../../i18n';
import { adminErrorKey, fill } from '../../../i18n/en';
import type { AudioSink } from '../../alerts/sounds';
import type { AdminPageApi, HubDevice, HubError, KdsConfig, KdsPoint, KdsScreen, KitchenScreensApi, PassTablet } from './api';
import { BindDialog, LaneLabelDialog } from './BindDialog';
import { PassTablets, StationRow } from './StationRow';
import { Warnings } from './Warnings';

// 03b §3.8, §6.9, §6.10, §6.12 (task A1; frames 03b-S04, C14, D02, D03, B16, F03): the hub admin "Kitchen screens"
// page at /admin/kitchen-screens/ (Q-43). Q-54: no timer — kds-config is read on open, on Reload and once after each
// own command; nothing else reads the hub.

export const TOAST_MS = 4_000;

export function errorText(error: HubError): string {
  if (error.kind === 'network') return t('admin_stock.errors.network');
  if (error.kind === 'signed_out') return t('errors.ADMIN_SESSION_REQUIRED');
  return t(adminErrorKey(error.code));
}

// ---- shared by the 03 admin pages (/admin/kitchen-screens/, /admin/printers/) ----

/**
 * 00 §8.2 (M86, S54 f): from tablet width the page sits in the hub admin shell (side-nav as /admin and
 * /admin/stock/, with the two 03 pages under "Other jobs"); on a phone it has only its own app bar.
 */
export function AdminShell({
  current,
  adminName,
  onSignOut,
  children,
}: {
  current: 'kitchen-screens' | 'printers';
  adminName: string | null;
  onSignOut: () => void;
  children: ReactNode;
}) {
  const phone = usePhone();
  if (phone) return <div className="pos-page pos-page--fit">{children}</div>;
  const other = t('admin_03.nav.other_jobs');
  return (
    <div className="pos-page pos-page--fit">
      <div className="pos-shell">
        <SideNav
          label={t('admin_stock.shell.title')}
          brand={{ title: t('admin_stock.shell.title') }}
          items={[
            { href: '/admin#', icon: 'grid', label: t('admin_stock.shell.home') },
            { href: '/admin#devices', icon: 'screen', label: t('admin_stock.shell.devices') },
            { href: '/admin#sessions', icon: 'user', label: t('admin_stock.shell.sessions') },
            { href: '/admin#lockouts', icon: 'lock', label: t('admin_stock.shell.lockouts') },
            { href: '/admin/stock/', icon: 'box', label: t('admin_stock.title'), group: other },
            { href: '/admin/kitchen-screens/', icon: 'screen', label: t('kitchen_screens.title'), group: other, current: current === 'kitchen-screens' },
            { href: '/admin/printers/', icon: 'list', label: t('printers.title'), group: other, current: current === 'printers' },
          ]}
          foot={
            <>
              {adminName !== null && (
                <div className="pos-sidenav__who">
                  <b>{adminName}</b>
                </div>
              )}
              <button type="button" className="pos-btn" onClick={onSignOut}>
                {t('admin_stock.sign_out')}
              </button>
            </>
          }
        />
        <div className="pos-shell__main">{children}</div>
      </div>
    </div>
  );
}

function loginError(error: HubError): { text: string; detail?: string } {
  if (error.kind !== 'api') return { text: errorText(error) };
  if (error.code === 'PIN_INVALID') {
    const left = error.details['attempts_remaining'];
    return typeof left === 'number' && left <= 2
      ? { text: t('errors.PIN_INVALID'), detail: fill(t('admin_stock.login.tries_left'), { n: String(left) }) }
      : { text: t('errors.PIN_INVALID') };
  }
  if (error.code === 'PIN_LOCKED_OUT' || error.code === 'DEVICE_LOCKED_OUT') {
    const ms = error.details['retry_after_ms'];
    const minutes = String(Math.max(1, Math.ceil((typeof ms === 'number' ? ms : 0) / 60_000)));
    return { text: t(adminErrorKey(error.code)), detail: fill(t('admin_stock.login.locked_for'), { n: minutes }) };
  }
  return { text: errorText(error) };
}

/**
 * 00 §8.2: no admin session → the admin roster and PIN pad (the endpoints /admin and /admin/stock/ use; the
 * session is shared through sessionStorage, 00 M89). Q-54: no retry timer; "Retry now" reads the roster again.
 */
export function AdminSignIn({
  api,
  title,
  chip,
  noAdmins,
  onLoggedIn,
}: {
  api: AdminPageApi;
  title: string;
  chip: MessageKey;
  noAdmins: MessageKey;
  onLoggedIn: () => void;
}) {
  const phone = usePhone();
  const [staff, setStaff] = useState<StaffTile[] | null>(null);
  const [offline, setOffline] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<HubError | null>(null);

  const load = useCallback(async () => {
    const answer = await api.roster();
    if (!answer.ok) {
      setOffline(answer.error.kind === 'network');
      if (answer.error.kind !== 'network') {
        setError(answer.error);
        setStaff([]);
      }
      return;
    }
    setOffline(false);
    setStaff(answer.data.staff.map((s) => ({ staff_id: s.staff_id, display_name: s.display_name, locked_until: s.locked_until, sub: (s.role_names ?? []).join(', ') })));
  }, [api]);

  useEffect(() => {
    void load();
  }, [load]);

  const submit = async (pin: string) => {
    if (selected === null) return;
    setBusy(true);
    setError(null);
    const answer = await api.login(selected, pin);
    setBusy(false);
    if (answer.ok) onLoggedIn();
    else setError(answer.error);
  };

  const banner = error === null ? null : loginError(error);
  const name = staff?.find((s) => s.staff_id === selected)?.display_name ?? '';
  return (
    <div className={`pos-page${phone ? '' : ' pos-page--fit'}`}>
      <AppBar title={title} phone={phone} after={<Chip icon="lock">{t(chip)}</Chip>} />
      {offline ? (
        <main className="pos-screen pos-screen--warn">
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
          <h2 className="pos-screen__title">{t(noAdmins)}</h2>
        </main>
      ) : (
        <main className="pos-content pos-signin">
          <section className="pos-signin__who">
            <div className="pos-section__head">
              <h2>{t('admin_stock.login.who')}</h2>
              <p>{t('admin_stock.login.pick')}</p>
            </div>
            <StaffTiles staff={staff} selectedId={selected} onPick={setSelected} />
            {banner !== null && selected === null && <Banner tone="danger" text={banner.text} detail={banner.detail} />}
          </section>
          {selected !== null && (
            <section className="pos-card pos-signin__pad">
              <div className="pos-signin__for">
                <strong>{fill(t('admin_stock.login.pin_for'), { name })}</strong>
              </div>
              {banner !== null && <Banner tone="danger" text={banner.text} detail={banner.detail} />}
              <PinPad onSubmit={(pin) => void submit(pin)} disabled={busy} error={error?.kind === 'api' && error.code === 'PIN_INVALID'} />
            </section>
          )}
        </main>
      )}
    </div>
  );
}

/** Shows `text` for TOAST_MS (a display timer, not a read). */
export function useToast(): [string | null, (text: string) => void] {
  const [toast, setToast] = useState<string | null>(null);
  useEffect(() => {
    if (toast === null) return;
    const timer = setTimeout(() => setToast(null), TOAST_MS);
    return () => clearTimeout(timer);
  }, [toast]);
  return [toast, setToast];
}

export function Toast({ text }: { text: string | null }) {
  if (text === null) return null;
  return (
    <div className="ad-toast" role="status">
      <Icon name="check" />
      {text}
    </div>
  );
}

// ---- the Kitchen screens page ----

export function KitchenScreensApp({ api, sink }: { api: KitchenScreensApi; sink: AudioSink }) {
  const [signedIn, setSignedIn] = useState(() => api.hasSession());
  if (!signedIn) {
    return (
      <AdminSignIn
        api={api}
        title={t('kitchen_screens.title')}
        chip="kitchen_screens.sign_in"
        noAdmins="kitchen_screens.no_admins"
        onLoggedIn={() => setSignedIn(true)}
      />
    );
  }
  return <KitchenScreens api={api} sink={sink} onSignedOut={() => setSignedIn(false)} />;
}

/** Q-43: `#bind=<device_id>` (00's Devices row "Use as Pass tablet") opens the bind dialog for that device. */
function bindTarget(hash: string): string | null {
  const match = /^#bind=(.+)$/.exec(hash);
  return match?.[1] === undefined ? null : decodeURIComponent(match[1]);
}

type Open =
  | { kind: 'lane'; screen: KdsScreen }
  | { kind: 'bind'; deviceId: string | null }
  | null;

/** Q-48: the points of the bind picker; before HK6 (no `points`) the point ids the page already knows. */
function pickablePoints(config: KdsConfig): KdsPoint[] {
  if (config.points !== undefined) return config.points;
  const ids = [...new Set([...config.stations.map((s) => s.point_id), ...config.pass_tablets.map((p) => p.point_id)])];
  return ids.map((point_id) => ({ point_id, name: point_id, is_archived: false }));
}

function KitchenScreens({ api, sink, onSignedOut }: { api: KitchenScreensApi; sink: AudioSink; onSignedOut: () => void }) {
  const phone = usePhone();
  const [config, setConfig] = useState<KdsConfig | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [open, setOpen] = useState<Open>(() => {
    const target = bindTarget(window.location.hash);
    return target === null ? null : { kind: 'bind', deviceId: target };
  });
  const [tablets, setTablets] = useState<HubDevice[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [dialogError, setDialogError] = useState<string | null>(null);
  // A refused page command (volume): shown until the next command, across the re-read.
  const [commandError, setCommandError] = useState<string | null>(null);
  const [toast, showToast] = useToast();
  // Only the latest read's answer is shown.
  const latest = useRef(0);

  const load = useCallback(async () => {
    const request = ++latest.current;
    const answer = await api.kdsConfig();
    if (request !== latest.current) return;
    if (!answer.ok) {
      if (answer.error.kind === 'signed_out') onSignedOut();
      else setProblem(errorText(answer.error));
      return;
    }
    setProblem(null);
    setConfig(answer.data);
  }, [api, onSignedOut]);

  useEffect(() => {
    void load();
  }, [load]);

  // The bind dialog's tablets (00 devices), read when it opens.
  const bindOpen = open?.kind === 'bind';
  useEffect(() => {
    if (!bindOpen) return;
    let live = true;
    setTablets(null);
    void api.devices().then((answer) => {
      if (!live) return;
      if (answer.ok) setTablets(answer.data.devices);
      else if (answer.error.kind === 'signed_out') onSignedOut();
      else {
        setTablets([]);
        setDialogError(errorText(answer.error));
      }
    });
    return () => {
      live = false;
    };
  }, [api, bindOpen, onSignedOut]);

  useEffect(() => {
    const onHash = () => {
      const target = bindTarget(window.location.hash);
      if (target !== null) {
        setDialogError(null);
        setOpen({ kind: 'bind', deviceId: target });
      }
    };
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);

  const close = () => {
    setOpen(null);
    setDialogError(null);
    if (bindTarget(window.location.hash) !== null) history.replaceState(null, '', window.location.pathname + window.location.search);
  };

  // One own command, then one kds-config read (Q-54). A refused dialog command keeps the dialog with its error.
  const run = async <T,>(send: (commandId: string) => Promise<{ ok: true; data: T } | { ok: false; error: HubError }>, done: () => void, inDialog: boolean) => {
    setBusy(true);
    setDialogError(null);
    setCommandError(null);
    const answer = await send(newUlid());
    setBusy(false);
    if (answer.ok) done();
    else if (answer.error.kind === 'signed_out') {
      onSignedOut();
      return;
    } else if (inDialog) setDialogError(laneOrError(answer.error));
    else setCommandError(errorText(answer.error));
    void load();
  };

  const saveVolume = (stationId: string, stationName: string, volume: number) =>
    void run(
      (id) => api.setStationScreen({ station_id: stationId, sound_volume: volume }, id),
      () => showToast(fill(t('admin.ks.volume_saved'), { station: stationName })),
      false,
    );

  const saveRole = (payload: { device_id: string; point_id?: string | null; lane_label?: string | null }) =>
    void run((id) => api.setDeviceRole(payload, id), close, true);

  const signOut = () => {
    void api.logout().then(onSignedOut);
  };

  const pointOf = (deviceId: string): string | null => config?.pass_tablets.find((p: PassTablet) => p.device_id === deviceId)?.point_id ?? null;
  // Phone: problems first (frame KitchenScreensPhone: the dark station on top).
  const stations = config === null ? [] : phone ? [...config.stations].sort((a, b) => Number(b.dark) - Number(a.dark)) : config.stations;

  return (
    <AdminShell current="kitchen-screens" adminName={api.adminName()} onSignOut={signOut}>
      <AppBar title={t('kitchen_screens.title')} phone={phone}>
        <button type="button" className="pos-btn" onClick={() => void load()}>
          <Icon name="reload" />
          {t('admin_stock.reload')}
        </button>
      </AppBar>
      {(problem !== null || commandError !== null) && (
        <div className="pos-banners">
          {problem !== null && <Banner tone="danger" text={problem} />}
          {commandError !== null && <Banner tone="danger" text={commandError} />}
        </div>
      )}
      {config !== null && <Warnings config={config} />}
      <main className="pos-content">
        {config === null ? (
          problem === null && <Skeleton lines={4} />
        ) : config.stations.length === 0 ? (
          <div className="pos-card ad-empty">
            <Icon name="screen" />
            <h2>{t('admin.ks.empty')}</h2>
            <p>{t('admin.ks.empty_hint')}</p>
          </div>
        ) : (
          <>
            <section className="ad-stack">
              <div className="ad-sec__h">
                <div>
                  <h2>{t('kitchen_screens.stations')}</h2>
                  <p>{t('kitchen_screens.stations_help')}</p>
                </div>
              </div>
              <div className={phone ? 'ad-stack' : 'ad-grid2'}>
                {stations.map((station) => (
                  <StationRow
                    key={station.station_id}
                    station={station}
                    points={config.points}
                    busy={busy}
                    sink={sink}
                    onVolume={(volume) => saveVolume(station.station_id, station.name, volume)}
                    onLaneLabel={(screen) => {
                      setDialogError(null);
                      setOpen({ kind: 'lane', screen });
                    }}
                  />
                ))}
              </div>
            </section>
            <PassTablets
              tablets={config.pass_tablets}
              points={config.points}
              busy={busy}
              onChange={(tablet) => {
                setDialogError(null);
                setOpen({ kind: 'bind', deviceId: tablet.device_id });
              }}
              onBind={() => {
                setDialogError(null);
                setOpen({ kind: 'bind', deviceId: null });
              }}
            />
          </>
        )}
      </main>
      {open?.kind === 'lane' && (
        <LaneLabelDialog
          screen={open.screen}
          busy={busy}
          error={dialogError}
          onSave={(label) => saveRole({ device_id: open.screen.device_id, lane_label: label })}
          onClose={close}
        />
      )}
      {open?.kind === 'bind' && config !== null && (
        <BindDialog
          tablets={tablets}
          points={pickablePoints(config)}
          stations={config.stations}
          initialDeviceId={open.deviceId}
          pointOf={pointOf}
          busy={busy}
          error={dialogError}
          onSave={(deviceId, pointId) => saveRole({ device_id: deviceId, point_id: pointId })}
          onUnbind={(deviceId) => saveRole({ device_id: deviceId, point_id: null })}
          onClose={close}
        />
      )}
      <Toast text={toast} />
    </AdminShell>
  );
}

// brief §3.4: VALIDATION_FAILED on a lane label = not a kitchen screen with a station.
function laneOrError(error: HubError): string {
  if (error.kind === 'api' && error.code === 'VALIDATION_FAILED' && error.details['field'] === 'lane_label') return t('kitchen_screens.lane_label_kds_only');
  return errorText(error);
}
