import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from 'react';
import { readDeviceKey, wipeDeviceKeys } from '../../api/hub-admin';
import { createHubClock, type HubClock } from '../../app/hub-clock';
import { t } from '../../i18n';
import { errorKey } from '../../i18n/en';
import { BACKOFF_MS, MAX_BACKOFF_MS, REPLACED_REASON, type AlertConnection, type SocketLike } from '../alerts/socket';
import { createAlertStore, type Timers } from '../alerts/store';
import { webAudioSink, type AudioSink, type ToneContext } from '../alerts/sounds';
import type { PageMeta } from '../staff/api';
import { createKdsApi, useKdsActions, type CompletionMode } from './actions/actions';
import { LOAD_NOTICE_MS, loadNotice, type LoadNotice } from './actions/batch';
import { RowActions } from './actions/DoneEarly';
import { GiveMeMore } from './actions/GiveMeMore';
import { InlineError } from './actions/InlineError';
import type { KdsApi } from './contracts';
import { branchConfigLoader, createKdsConfig } from './config';
import { ComingUp } from './header/ComingUp';
import { Header } from './header/Header';
import { createKdsLive } from './live';
import { startStationSession, type KdsPage, type StationAuth, type StationSession } from './session';
import { Placeholder } from './station/Placeholder';
import { StationView } from './station/StationView';
import { Archived } from './states/Archived';
import { DayNotStarted } from './states/DayNotStarted';
import { subscribeFrames } from './slots';
import { createKdsStore, type KdsStoreImpl } from './store';

// 03b v1.0.8 §8 (Q-42), §3.3, #72; 00 v1.9.2 §8.2, §8.4 (K1): the /kds/ app.
// 1. Reads the device token of the pairing store and calls POST /auth/station (the session token stays in memory).
//    No token / no page meta → "pair again" (nothing to wipe). 401 DEVICE_TOKEN_INVALID / 403 DEVICE_REVOKED, and later
//    a socket close 4403 → the pairing keys are wiped, then "pair again" → /pair. 403 DEVICE_TYPE_NOT_ALLOWED → the
//    keys stay: "This device isn't a kitchen screen" with a link to /staff/. No reply or another error → the keys stay
//    and the call is tried again (backoff ≤ 5 s, as the socket); the first-load skeleton shows meanwhile.
// 2. Opens the station socket (live.ts). Before the first catch-up: the skeleton (03b-F02). While the socket is down
//    (after it was up): the Reconnecting banner (03b-B06), rows stay as they were, every button disabled; the socket
//    reconnects by itself and its catch-up replaces the store (no reload, no queue: a tap during the outage is lost).
// 3. Close 4401 `replaced` (another window took the station session, M53) → stop, "This screen is open in another
//    window"; only a tap on "Use this window" calls /auth/station again, once. Another 4401 (session ended) → a new
//    station session (the same call). 4426 → "needs an update".
// The station view itself (K2), actions (K3), header / states (K4) and sounds (K5) render inside this shell through
// `useKds()`.

/** What the lane's screens read: envelope ids, the hub clock, the station session, the store and the socket state. */
export interface KdsCtx {
  meta: PageMeta;
  clock: HubClock;
  deviceToken: string;
  session: StationSession;
  store: KdsStoreImpl;
  /** the socket is up: buttons work */
  up: boolean;
  fetch: (input: string, init?: RequestInit) => Promise<Response>;
  /** the station commands on this session (K3) */
  api: KdsApi;
}

const Ctx = createContext<KdsCtx | null>(null);

export function useKds(): KdsCtx {
  const ctx = useContext(Ctx);
  if (ctx === null) throw new Error('useKds outside KdsApp');
  return ctx;
}

export interface KdsAppProps {
  page: KdsPage | null;
  fetch?: (input: string, init?: RequestInit) => Promise<Response>;
  createSocket?: (url: string) => SocketLike;
  timers?: Timers;
  sink?: AudioSink;
  /** the pairing store reader (default hub-admin readDeviceKey) */
  readKey?: (key: string) => Promise<string | null>;
  /** forgets token / device_id / device_type (default hub-admin wipeDeviceKeys) */
  wipeKeys?: () => Promise<void>;
  /** navigation (default location.assign) */
  go?: (path: string) => void;
}

type Screen = 'guest' | 'not_set_up' | 'host' | 'upgrade' | 'busy' | 'meta' | 'error';

type Phase =
  | { k: 'starting'; offline: boolean }
  | { k: 'live'; session: StationSession; token: string; deviceId: string }
  | { k: 'replaced'; token: string }
  | { k: 'unpaired'; wipe: 'none' | 'pending' | 'done' | 'failed' }
  | { k: 'not_kds' }
  | { k: 'screen'; screen: Screen; token: string | null; code?: string };

/**
 * 00 §8.4 (the hub's lib/global-state.ts table, F01–F07) for a POST /auth/station that gave no session:
 * - `retry`: try again with the socket backoff (≤ 5 s) while `show` is on screen — no reply / 5xx ("Can't reach the
 *   hub — retrying…"), the guest network and a hub being set up ("opens by itself"); `wait` replaces the backoff;
 * - otherwise `show` stays until a tap ("Try again", "Reload").
 * SERVICE_UNAVAILABLE: one silent retry after retry_after_ms (≤ 5 s), then "Hub busy, try again".
 */
export function stateForAuth(
  r: Exclude<StationAuth, { kind: 'ok' } | { kind: 'unpaired' } | { kind: 'not_kds' }>,
  busyRetried: boolean,
): { show: Screen | 'offline' | 'silent'; retry: boolean; wait?: number } {
  if (r.kind === 'network') return { show: 'offline', retry: true };
  switch (r.code) {
    case 'GUEST_NETWORK_FORBIDDEN':
      return { show: 'guest', retry: true };
    case 'HUB_NOT_PROVISIONED':
      return { show: 'not_set_up', retry: true };
    case 'HOST_NOT_ALLOWED':
      return { show: 'host', retry: false };
    case 'CLIENT_UPGRADE_REQUIRED':
      return { show: 'upgrade', retry: false };
    case 'SERVICE_UNAVAILABLE': {
      if (busyRetried) return { show: 'busy', retry: false };
      const ms = r.details['retry_after_ms'];
      return { show: 'silent', retry: true, wait: typeof ms === 'number' && ms > 0 ? Math.min(ms, MAX_BACKOFF_MS) : 1_000 };
    }
  }
  if (r.status === 426) return { show: 'upgrade', retry: false };
  if (r.status >= 500) return { show: 'offline', retry: true };
  return { show: 'error', retry: false };
}

/** display tick: Done rows leave after UNDO_DONE_MS; reads nothing from the hub */
const TICK_MS = 1_000;

const browserTimers: Timers = {
  setTimeout: (fn, ms) => window.setTimeout(fn, ms),
  clearTimeout: (handle) => window.clearTimeout(handle as number),
};

let audio: AudioContext | null = null;
const browserSink = webAudioSink(() => {
  try {
    audio ??= new AudioContext();
    return audio as unknown as ToneContext;
  } catch {
    return null;
  }
});

export function KdsApp({ page, fetch, createSocket, timers, sink, readKey, wipeKeys, go }: KdsAppProps) {
  const fetchFn = useMemo(() => fetch ?? ((input: string, init?: RequestInit) => window.fetch(input, init)), [fetch]);
  const tm = timers ?? browserTimers;
  const [phase, setPhase] = useState<Phase>({ k: 'starting', offline: false });
  const alive = useRef(true);
  /** bumped when the start effect is cleaned up: a reply of an earlier start (StrictMode, unmount) is dropped */
  const gen = useRef(0);
  const retry = useRef<unknown>(null);
  const attempt = useRef(0);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      if (retry.current !== null) tm.clearTimeout(retry.current);
      retry.current = null;
    };
  }, [tm]);

  const busyRetried = useRef(false);
  /** a DeviceRevoked for this device came on the live socket before its close (00 §6.14): 4403 = revoked */
  const revoked = useRef(false);

  const unpair = useCallback(() => {
    setPhase({ k: 'unpaired', wipe: 'pending' });
    (wipeKeys ?? wipeDeviceKeys)().then(
      () => alive.current && setPhase({ k: 'unpaired', wipe: 'done' }),
      () => alive.current && setPhase({ k: 'unpaired', wipe: 'failed' }),
    );
  }, [wipeKeys]);

  const authRef = useRef<(known?: string) => Promise<void>>(async () => {});
  /** the next call after the socket backoff (≤ 5 s); `attempt` goes back to 0 once a socket is up */
  const later = useCallback(
    (token: string | undefined, ms?: number) => {
      const wait = ms ?? (attempt.current < BACKOFF_MS.length ? BACKOFF_MS[attempt.current]! : MAX_BACKOFF_MS);
      if (ms === undefined) attempt.current += 1;
      if (retry.current !== null) tm.clearTimeout(retry.current);
      retry.current = tm.setTimeout(() => {
        retry.current = null;
        void authRef.current(token);
      }, wait);
    },
    [tm],
  );

  const auth = useCallback(
    async (known?: string) => {
      const my = gen.current;
      const stale = () => !alive.current || gen.current !== my;
      let token: string | null;
      let deviceId: string | null;
      try {
        const read = readKey ?? readDeviceKey;
        [token, deviceId] = await Promise.all([known === undefined ? read('token') : Promise.resolve(known), read('device_id')]);
      } catch {
        // the pairing store could not be read (IndexedDB error): nothing is wiped; read it again
        if (stale()) return;
        setPhase({ k: 'starting', offline: false });
        later(undefined);
        return;
      }
      if (stale()) return;
      if (token === null || deviceId === null) {
        setPhase({ k: 'unpaired', wipe: 'none' });
        return;
      }
      // a page served without its meta is a serving fault, not a pairing one (/pair would send it straight back)
      if (page === null) {
        setPhase({ k: 'screen', screen: 'meta', token });
        return;
      }
      const result = await startStationSession({ fetch: fetchFn, deviceToken: token });
      if (stale()) return;
      switch (result.kind) {
        case 'ok':
          busyRetried.current = false;
          revoked.current = false;
          setPhase({ k: 'live', session: result.session, token, deviceId });
          return;
        case 'unpaired':
          unpair();
          return;
        case 'not_kds':
          setPhase({ k: 'not_kds' });
          return;
        default: {
          // the keys stay (00 §8.4)
          const next = stateForAuth(result, busyRetried.current);
          if (result.kind === 'error' && result.code === 'SERVICE_UNAVAILABLE') busyRetried.current = !busyRetried.current && next.retry;
          if (next.show === 'offline') setPhase({ k: 'starting', offline: true });
          else if (next.show !== 'silent') setPhase({ k: 'screen', screen: next.show, token, ...(result.kind === 'error' ? { code: result.code } : {}) });
          if (next.retry) later(token, next.wait);
        }
      }
    },
    [fetchFn, page, readKey, unpair, later],
  );
  authRef.current = auth;

  useEffect(() => {
    void auth();
    return () => {
      gen.current += 1;
      if (retry.current !== null) tm.clearTimeout(retry.current);
      retry.current = null;
    };
  }, [auth, tm]);

  const again = (token: string | null) => {
    busyRetried.current = false;
    setPhase({ k: 'starting', offline: false });
    void auth(token ?? undefined);
  };

  let body: ReactNode;
  switch (phase.k) {
    case 'live':
      body = (
        <Live
          page={page!}
          session={phase.session}
          token={phase.token}
          deviceId={phase.deviceId}
          fetch={fetchFn}
          timers={tm}
          sink={sink ?? browserSink}
          {...(createSocket === undefined ? {} : { createSocket })}
          onUp={() => (attempt.current = 0)}
          onRevoked={() => (revoked.current = true)}
          onEnded={(code, reason) => {
            const token = phase.token;
            if (code === 4403) {
              // 00 §8.4: wipe only for the device token (non-guest). A DeviceRevoked on this socket says so; without
              // it (4403 before auth = the guest network) /auth/station answers which it is, and the keys stay.
              if (revoked.current) unpair();
              else {
                setPhase({ k: 'starting', offline: false });
                later(token);
              }
            } else if (code === 4426) setPhase({ k: 'screen', screen: 'upgrade', token });
            else if (code === 4409 || reason === 'replaced' || reason === REPLACED_REASON) setPhase({ k: 'replaced', token });
            else {
              // the session ended another way (00 §8.4: go to login): a new station session, after the backoff
              setPhase({ k: 'starting', offline: false });
              later(token);
            }
          }}
        />
      );
      break;
    case 'starting':
      body = <Loading offline={phase.offline} />;
      break;
    case 'replaced':
      body = (
        <Message title={t('kds.replaced')}>
          <button type="button" className="btn btn--primary btn--lg" onClick={() => again(phase.token)}>
            {t('kds.use_this_window')}
          </button>
        </Message>
      );
      break;
    case 'not_kds':
      body = (
        <Message title={t('kds.not_kitchen_screen')} sub={t('kds.not_kitchen_screen_sub')}>
          <a className="btn btn--primary btn--lg" href="/staff/">
            {t('kds.open_staff')}
          </a>
        </Message>
      );
      break;
    case 'screen':
      body = <ScreenMessage screen={phase.screen} code={phase.code} onAgain={() => again(phase.token)} onReload={() => window.location.reload()} />;
      break;
    case 'unpaired':
      body = (
        <Message title={t('pair.again')} sub={t('kds.pair_again_sub')}>
          {phase.wipe === 'failed' && (
            <p className="msg c-danger" role="alert">
              {t('pair.wipe_failed')}
            </p>
          )}
          <button
            type="button"
            className="btn btn--primary btn--lg"
            disabled={phase.wipe === 'pending' || phase.wipe === 'failed'}
            onClick={() => (go ?? ((path: string) => window.location.assign(path)))('/pair')}
          >
            {t('pair.show_code')}
          </button>
        </Message>
      );
      break;
  }

  return (
    <div className="pu v-brand kds" lang="en" dir="ltr" data-theme="dark">
      <div className="col grow">{body}</div>
    </div>
  );
}

function Live({
  page,
  session,
  token,
  deviceId,
  fetch,
  timers,
  sink,
  createSocket,
  onEnded,
  onUp,
  onRevoked,
}: {
  page: KdsPage;
  session: StationSession;
  token: string;
  deviceId: string;
  fetch: (input: string, init?: RequestInit) => Promise<Response>;
  timers: Timers;
  sink: AudioSink;
  createSocket?: (url: string) => SocketLike;
  onEnded: (code: number, reason: string) => void;
  onUp: () => void;
  onRevoked: () => void;
}) {
  const endedRef = useRef(onEnded);
  endedRef.current = onEnded;
  const upRef = useRef(onUp);
  upRef.current = onUp;
  const revokedRef = useRef(onRevoked);
  revokedRef.current = onRevoked;
  // S47: the hub clock from the page meta, re-synced from branch-config `hub_time` (K4)
  const clock = useRef<HubClock>(page.clock);
  const store = useMemo(() => createKdsStore({ stationId: session.station_id, now: () => clock.current.nowMs() }), [session.station_id]);
  const alerts = useMemo(() => createAlertStore({ sink, timers, alwaysOn: true }), [sink, timers]);
  useEffect(() => () => alerts.dispose(), [alerts]);
  const [conn, setConn] = useState<AlertConnection | null>(null);
  useEffect(() => {
    const c = createKdsLive({
      deviceToken: token,
      sessionToken: session.session_token,
      store,
      alerts,
      timers,
      ...(createSocket === undefined ? {} : { createSocket }),
      onEnded: (code, reason) => endedRef.current(code, reason),
      onRevoked: () => revokedRef.current(),
    });
    setConn(c);
    return () => c.dispose();
  }, [token, session.session_token, store, alerts, timers, createSocket]);

  const up = useSyncExternalStore(
    (fn) => conn?.subscribe(fn) ?? (() => {}),
    () => conn?.isUp() ?? false,
  );
  const view = useSyncExternalStore(store.subscribe, store.snapshot);
  // a socket that passed auth ends the backoff (a 4401 right after a fresh session waits ≤ 5 s, never loops)
  useEffect(() => {
    if (up) upRef.current();
  }, [up]);

  // display tick (no hub read): the timers count on the hub clock, Done rows leave after their undo window
  const [nowMs, setNowMs] = useState(() => clock.current.nowMs());
  useEffect(() => {
    let handle: unknown = null;
    const tick = () => {
      setNowMs(clock.current.nowMs());
      store.prune();
      handle = timers.setTimeout(tick, TICK_MS);
    };
    handle = timers.setTimeout(tick, TICK_MS);
    return () => timers.clearTimeout(handle);
  }, [store, timers]);

  // K3: the station commands on this session, the row states, the batch notice
  const api = useMemo(
    () => createKdsApi({ fetch, meta: page.meta, deviceId, deviceToken: token, sessionToken: session.session_token, nowMs: () => clock.current.nowMs() }),
    [fetch, page, deviceId, token, session],
  );
  const [load, setLoad] = useState<LoadNotice | null>(null);
  const loadTimer = useRef<unknown>(null);
  useEffect(() => () => void (loadTimer.current !== null && timers.clearTimeout(loadTimer.current)), [timers]);
  const actions = useKdsActions(api, timers, (r) => {
    if (loadTimer.current !== null) timers.clearTimeout(loadTimer.current);
    setLoad(loadNotice(r));
    loadTimer.current = timers.setTimeout(() => {
      loadTimer.current = null;
      setLoad(null);
    }, LOAD_NOTICE_MS);
  });
  // K4: the station's config (name, completion mode, type), read on open, catch-up and BranchConfigApplied (#75)
  const config = useMemo(
    () => createKdsConfig({ stationId: session.station_id, load: branchConfigLoader({ fetch, deviceToken: token, sessionToken: session.session_token }) }),
    [session, fetch, token],
  );
  useEffect(() => {
    const off = subscribeFrames((f) => config.onFrame(f));
    return () => {
      off();
      config.dispose();
    };
  }, [config]);
  const cfg = useSyncExternalStore(config.subscribe, config.state);
  useEffect(() => {
    if (cfg.hub_time !== null) clock.current = createHubClock(cfg.hub_time);
  }, [cfg.hub_time]);
  /** 03b §3.3: null until the config is read (Start, then Done) */
  const mode: CompletionMode = cfg.station?.completion_mode ?? null;

  // the clock ref follows cfg.hub_time (a dependency on purpose)
  const ctx = useMemo<KdsCtx>(
    () => ({ meta: page.meta, clock: clock.current, deviceToken: token, session, store, up, fetch, api }),
    [page, token, session, store, up, fetch, api, cfg.hub_time],
  );

  if (view.station === null) return <Loading offline={false} />;
  const station = view.station;
  const empty = view.rows.length === 0 && (view.plan?.lines.some((l) => l.frozen) ?? false) === false;
  // §3.10: the archived banner while the station still has lines (the notice's count; else the archived config's)
  const archived = empty ? null : (view.archived?.open_lines ?? (cfg.station?.is_archived === true ? view.rows.length : null));
  return (
    <Ctx.Provider value={ctx}>
      <Header name={cfg.station?.name ?? ''} lanes={station.lanes} stationId={session.station_id} api={api} up={up} showLanes={station.day_open} />
      {!station.day_open ? (
        <DayNotStarted />
      ) : (
        <>
          <ComingUp view={view} />
          {/* K2: the station view (Now / Next / Later) */}
          <StationView
            view={view}
            nowMs={nowMs}
            utcOffsetMs={clock.current.utcOffsetMs}
            up={up}
            batch={cfg.station?.station_type === 'batch'}
            banner={
              !up ? (
                <div className="kbn c-danger" role="status">
                  {t('kds.reconnecting_banner')}
                  <small>{t('kds.reconnecting_note')}</small>
                </div>
              ) : archived !== null ? (
                <Archived open={archived} />
              ) : load !== null ? (
                <div className="kbn c-info" role="status">
                  {load.text}
                </div>
              ) : undefined
            }
            {...(load === null ? {} : { highlight: load.ids })}
            actionsFor={(row) => (
              <RowActions row={row} mode={mode} nowMs={nowMs} up={up} state={actions.stateOf(row.order_item_id)} onTap={(a, confirm) => void actions.tap(row, a, confirm)} />
            )}
            messageFor={(row) => <InlineError msg={actions.stateOf(row.order_item_id).msg} />}
            nextFooter={<GiveMeMore api={api} stationId={session.station_id} up={up} timers={timers} />}
          />
        </>
      )}
    </Ctx.Provider>
  );
}

/** 03b-F02: skeleton header and three skeleton rows; with "Can't reach the hub" while /auth/station gets no reply */
function Loading({ offline }: { offline: boolean }) {
  return (
    <>
      <header className="kbar">
        <div className="kbar__st">
          <span className="sk sk--kid" />
        </div>
      </header>
      <main className={offline ? 'kgrid kgrid--bar' : 'kgrid'}>
        {offline && (
          <div className="kbn c-danger" role="status">
            {t('kds.hub_unreachable')}
          </div>
        )}
        <section className="ksec">
          <div className="ksec__h">{t('kds.loading')}</div>
          <div className="kcards">
            {[0, 1, 2].map((i) => (
              <Placeholder key={i} off={false} compact={false} />
            ))}
          </div>
        </section>
        <aside className="knx" />
      </main>
    </>
  );
}

function Message({ title, sub, children }: { title: string; sub?: string; children?: ReactNode }) {
  return (
    <main className="body">
      <section className="card empty" aria-labelledby="kds-msg-title">
        <b id="kds-msg-title">{title}</b>
        {sub !== undefined && <p className="muted">{sub}</p>}
        {children}
      </section>
    </main>
  );
}

/** 00 §8.4 screens (00-F03, F04, F05, F06, F07; the meta-missing fault; any other refusal by its errors.<code>) */
function ScreenMessage({ screen, code, onAgain, onReload }: { screen: Screen; code: string | undefined; onAgain: () => void; onReload: () => void }) {
  const again = (
    <button type="button" className="btn btn--primary btn--lg" onClick={onAgain}>
      {t('kds.try_again')}
    </button>
  );
  const reload = (
    <button type="button" className="btn btn--primary btn--lg" onClick={onReload}>
      {t('kds.reload')}
    </button>
  );
  switch (screen) {
    case 'guest':
      return <Message title={t('kds.wifi_title')} sub={t('kds.wifi_body')} />;
    case 'not_set_up':
      return <Message title={t('kds.not_set_up_title')} sub={t('kds.not_set_up_body')} />;
    case 'host':
      return <Message title={t('kds.wrong_host_title')} sub={t('kds.wrong_host_body')} />;
    case 'upgrade':
      return (
        <Message title={t('kds.update_title')} sub={t('kds.update_body')}>
          {reload}
        </Message>
      );
    case 'busy':
      return (
        <Message title={t('kds.busy')} sub={t('kds.busy_small')}>
          {again}
        </Message>
      );
    case 'meta':
      return (
        <Message title={t('kds.page_fault')} sub={t('kds.page_fault_body')}>
          {reload}
        </Message>
      );
    case 'error':
      return <Message title={t(errorKey(code ?? 'UNKNOWN'))}>{again}</Message>;
  }
}
